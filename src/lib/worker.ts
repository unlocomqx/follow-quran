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

const MAX_NEW_TOKENS = 64;
const VERSES_CACHE_KEY =
	'/quran.json';

interface Chapter {
	id: number;
	verses: Verse[];
}

interface Verse {
	surah: number;
	ayah: number;
	text: string;
}

async function getRemoteSha(): Promise<string | null> {
	const res = await fetch(VERSES_CACHE_KEY,{
		method: 'HEAD'
	});
	if (!res.ok) return null;
	return res.headers.get('ETag') || null;
}

async function loadVersesWithCache(): Promise<Verse[]> {
	const cache = await caches.open('quran-verses');
	const remoteSha = await getRemoteSha();
	const cacheKey = `${VERSES_CACHE_KEY}?sha=${remoteSha}`;
	const cached = await cache.match(cacheKey);

	if (cached) {
		return cached.json();
	}

	const blob = await fetch(VERSES_CACHE_KEY);
	if (!blob.ok) throw new Error('Failed to download verses');

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

async function generate({ audio }: { audio: Float32Array }) {
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

async function search({ text, current_surah }: { text: string; current_surah?: number }) {
	const query = removeDiacritics(text);
	const nb_words = query.split(/\s+/).length;
	if(nb_words < 3){
		self.postMessage({ status: 'search_complete', results: [] });
		return;
	}
	if (current_surah){
		const within_surah = await searchQuran(query, current_surah);
		const trusted_within_surah = within_surah.filter((v) => v.score > 0.85);
		if (trusted_within_surah.length > 0) {
			self.postMessage({ status: 'search_complete', results: trusted_within_surah });
			return;
		}
	}

	const results = await searchQuran(query);
	const trusted_results = results.filter((v) => v.score > 0.85);
	// console.log('full search', query, trusted_results);
	self.postMessage({ status: 'search_complete', results: trusted_results });
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
			await search(data);
			break;
	}
});

function removeDiacritics(text: string): string {
	return text.replace(/[\u064B-\u065F\u0670]/g, '');
}

async function searchQuran(query: string, current_surah?: number, topK = 10) {
	const [, , , verses] = await AutomaticSpeechRecognitionPipeline.getInstance();

	return verses
		.filter((verse) => !current_surah || verse.surah === current_surah)
		.map((verse, index) => ({
			...verse,
			score: phraseMatchScore(query, combineVerses(verses, index))
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

function combineVerses(verses: Verse[], index: number): string {
	const verse = verses[index];
	const prevVerse = verses[index - 1];
	const nextVerse = verses[index + 1];
	const prevText = prevVerse?.text || '';
	const nextText = nextVerse?.text || '';
	return `${verse.text}[${index}]${nextText}`;
}
