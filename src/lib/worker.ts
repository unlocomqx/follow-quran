import {
	AutoProcessor,
	AutoTokenizer,
	full,
	type PreTrainedTokenizer,
	type Processor,
	type ProgressCallback,
	TextStreamer,
	WhisperForConditionalGeneration
} from '@huggingface/transformers';
import { downloadFile } from '@huggingface/hub';

const MAX_NEW_TOKENS = 64;
const VERSES_CACHE_KEY =
	'https://huggingface.co/datasets/eventhorizon0/quran-embeddings-ar/resolve/main/data/quran_embeddings.json';

const HF_REPO = 'eventhorizon0/quran-embeddings-ar';
const HF_PATH = 'data/quran_embeddings.json';

interface Verse {
	surah: number;
	ayah: number;
	text: string;
}

async function getRemoteSha(): Promise<string | null> {
	const res = await fetch(`https://huggingface.co/api/datasets/${HF_REPO}`);
	if (!res.ok) return null;
	const info = await res.json();
	return info.sha || null;
}

async function loadVersesWithCache(): Promise<Verse[]> {
	const cache = await caches.open('quran-verses');
	const remoteSha = await getRemoteSha();
	const cacheKey = `${VERSES_CACHE_KEY}?sha=${remoteSha}`;
	const cached = await cache.match(cacheKey);

	if (cached) {
		return cached.json();
	}

	const blob = await downloadFile({
		repo: { type: 'dataset', name: HF_REPO },
		path: HF_PATH
	});
	if (!blob) throw new Error('Failed to download verses');

	const text = await blob.text();
	await cache.put(
		cacheKey,
		new Response(text, { headers: { 'Content-Type': 'application/json' } })
	);
	return JSON.parse(text);
}

class AutomaticSpeechRecognitionPipeline {
	static model_id: string | null = null;
	static tokenizer: Promise<PreTrainedTokenizer> | null = null;
	static processor: Promise<Processor> | null = null;
	static model: Promise<InstanceType<typeof WhisperForConditionalGeneration>> | null = null;
	static verses_promise: Promise<Verse[]> | null = null;

	static async getInstance(progress_callback?: ProgressCallback) {
		this.model_id = 'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran';

		this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
			progress_callback
		});
		this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
			progress_callback
		});

		this.model ??= WhisperForConditionalGeneration.from_pretrained(this.model_id, {
			dtype: {
				encoder_model: 'fp32',
				decoder_model_merged: 'q4'
			},
			device: 'webgpu',
			progress_callback
		}) as Promise<InstanceType<typeof WhisperForConditionalGeneration>>;

		this.verses_promise ??= loadVersesWithCache();

		return Promise.all([this.tokenizer, this.processor, this.model, this.verses_promise]);
	}
}

async function load() {
	self.postMessage({
		status: 'loading',
		data: 'Loading model...'
	});

	const [, , model] = await AutomaticSpeechRecognitionPipeline.getInstance((x) => {
		self.postMessage(x);
	});

	self.postMessage({
		status: 'loading',
		data: 'Compiling shaders and warming up model...'
	});

	await (model.generate as CallableFunction)({
		input_features: full([1, 80, 3000], 0.0),
		max_new_tokens: 1
	});

	self.postMessage({ status: 'ready' });
}

let processing = false;

async function generate({ audio, language }: { audio: Float32Array; language?: string }) {
	if (processing) return;
	processing = true;

	self.postMessage({ status: 'start' });

	const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();

	let startTime: number | undefined;
	let numTokens = 0;

	const callback_function = (output: string) => {
		startTime ??= performance.now();

		let tps: number | undefined;
		if (numTokens++ > 0) {
			tps = (numTokens / (performance.now() - startTime)) * 1000;
		}
		self.postMessage({
			status: 'update',
			output,
			tps,
			numTokens
		});
	};

	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function
	});

	const inputs = await processor(audio);

	const outputs = await model.generate({
		...inputs,
		max_new_tokens: MAX_NEW_TOKENS,
		// language,
		streamer
	});

	const outputText = tokenizer.batch_decode(outputs as unknown as number[][], {
		skip_special_tokens: true
	});

	self.postMessage({
		status: 'complete',
		output: outputText
	});
	processing = false;
}

async function search(text: string) {
	const results = await searchQuran(text);
	console.log(removeDiacritics(text), results);
	self.postMessage({ status: 'search', results });
}

self.addEventListener('message', async (e: MessageEvent) => {
	const { type, data } = e.data;

	switch (type) {
		case 'load':
			await load();
			break;
		case 'generate':
			await generate(data);
			break;
		case 'search':
			await search(data.text);
			break;
	}
});

function removeDiacritics(text: string): string {
	return text.replace(/[\u064B-\u065F\u0670]/g, '');
}

async function searchQuran(query: string, topK = 30) {
	const [, , , verses] = await AutomaticSpeechRecognitionPipeline.getInstance();
	const normalizedQuery = removeDiacritics(query);

	return verses
		.map((verse) => ({
			...verse,
			score: phraseMatchScore(normalizedQuery, removeDiacritics(verse.text))
		}))
		.filter((v) => v.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

function phraseMatchScore(query: string, text: string): number {
	// exact substring match gets highest score
	if (text.includes(query)) {
		return 1 + query.length / text.length;
	}

	// check word overlap
	const queryWords = query.split(/\s+/);
	const textWords = text.split(/\s+/);
	let matchedWords = 0;
	let consecutiveBonus = 0;
	let lastMatchIdx = -2;

	for (const qWord of queryWords) {
		const idx = textWords.findIndex((tWord) => tWord.includes(qWord) || qWord.includes(tWord));
		if (idx !== -1) {
			matchedWords++;
			if (idx === lastMatchIdx + 1) consecutiveBonus += 0.2;
			lastMatchIdx = idx;
		}
	}

	if (matchedWords === 0) return 0;

	const wordScore = matchedWords / queryWords.length;
	const lengthPenalty = Math.min(1, query.length / text.length);

	return wordScore * 0.7 + consecutiveBonus + lengthPenalty * 0.1;
}
