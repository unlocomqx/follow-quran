import {
	AutoProcessor,
	AutoTokenizer,
	full,
	pipeline,
	type PreTrainedTokenizer,
	type Processor,
	type ProgressCallback,
	TextStreamer,
	WhisperForConditionalGeneration
} from '@huggingface/transformers';
import { downloadFile } from '@huggingface/hub';

const MAX_NEW_TOKENS = 64;
const EMBEDDINGS_CACHE_KEY =
	'https://huggingface.co/eventhorizon0/quran-embeddings-ar/resolve/main/data/quran_embeddings.json';

const HF_REPO = 'eventhorizon0/quran-embeddings-ar';
const HF_PATH = 'data/quran_embeddings.json';

async function getRemoteSha(): Promise<string | null> {
	const res = await fetch(`https://huggingface.co/api/models/${HF_REPO}`);
	if (!res.ok) return null;
	const info = await res.json();
	return info.sha || null;
}

async function loadEmbeddingsWithCache() {
	const cache = await caches.open('quran-embeddings');
	const remoteSha = await getRemoteSha();
	const cacheKey = `${EMBEDDINGS_CACHE_KEY}?sha=${remoteSha}`;
	const cached = await cache.match(cacheKey);

	if (cached) {
		return cached.json();
	}

	const blob = await downloadFile({
		repo: HF_REPO,
		path: HF_PATH,
		revision: remoteSha
	});
	if (!blob) throw new Error('Failed to download embeddings');

	const text = await blob.text();
	await cache.put(
		cacheKey,
		new Response(text, { headers: { 'Content-Type': 'application/json' } })
	);
	return JSON.parse(text);
}

class AutomaticSpeechRecognitionPipeline {
	static model_id: string | null = null;
	static search_model_id: string | null = null;
	static tokenizer: Promise<PreTrainedTokenizer> | null = null;
	static processor: Promise<Processor> | null = null;
	static model: Promise<InstanceType<typeof WhisperForConditionalGeneration>> | null = null;
	static search_model;
	static embeddings_promise;

	static async getInstance(progress_callback?: ProgressCallback) {
		this.model_id = 'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran';
		this.search_model_id = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

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

		this.search_model ??= await pipeline('feature-extraction', this.search_model_id,{
			progress_callback
		});

		this.embeddings_promise ??= loadEmbeddingsWithCache();

		return Promise.all([
			this.tokenizer,
			this.processor,
			this.model,
			this.search_model,
			this.embeddings_promise
		]);
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
	console.log(text );
	const results = await searchQuran(text);

	results.sort((a, b) => b.score - a.score);

	console.log(results);

	self.postMessage({
		status: 'search',
		results
	});
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

async function searchQuran(query, topK = 30) {
	const [, , , extractor, embeddings] = await AutomaticSpeechRecognitionPipeline.getInstance();
	const output = await extractor(query, { pooling: 'mean', normalize: true });
	const queryEmb = Array.from(output.data);

	return embeddings
		.map((e) => ({ ...e, score: dotProduct(queryEmb, e.embedding) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

function dotProduct(a, b) {
	return a.reduce((sum, val, i) => sum + val * b[i], 0);
}
