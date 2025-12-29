import {
	AutoTokenizer,
	AutoProcessor,
	WhisperForConditionalGeneration,
	TextStreamer,
	full,
	type PreTrainedTokenizer,
	type Processor,
	type ProgressCallback, pipeline
} from "@huggingface/transformers";
import { downloadFile } from "@huggingface/hub";

const MAX_NEW_TOKENS = 64;

class AutomaticSpeechRecognitionPipeline {
	static model_id: string | null = null;
	static search_model_id: string | null = null;
	static tokenizer: Promise<PreTrainedTokenizer> | null = null;
	static processor: Promise<Processor> | null = null;
	static model: Promise<InstanceType<typeof WhisperForConditionalGeneration>> | null = null;
	static search_model
	static embeddings_promise

	static async getInstance(progress_callback?: ProgressCallback) {
		this.model_id = 'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran';
		this.search_model_id = "Xenova/all-MiniLM-L6-v2";

		this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
			progress_callback
		});
		this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
			progress_callback
		});

		this.model ??= WhisperForConditionalGeneration.from_pretrained(this.model_id, {
			dtype: {
				encoder_model: "fp32",
				decoder_model_merged: "q4"
			},
			device: 'webgpu',
			progress_callback
		}) as Promise<InstanceType<typeof WhisperForConditionalGeneration>>;

		this.search_model ??= await pipeline('feature-extraction', this.search_model_id);

		this.embeddings_promise ??= downloadFile({
			repo: 'eventhorizon0/quran-embeddings-ar',
			path: 'data/quran_embeddings.json'
		}).then((blob) => blob?.text()).then((text) => text && JSON.parse(text));

		return Promise.all([this.tokenizer, this.processor, this.model, this.search_model, this.embeddings_promise]);
	}
}

async function load() {
	self.postMessage({
		status: "loading",
		data: "Loading model..."
	});

	const [, , model] = await AutomaticSpeechRecognitionPipeline.getInstance((x) => {
		self.postMessage(x);
	});

	self.postMessage({
		status: "loading",
		data: "Compiling shaders and warming up model..."
	});

	await (model.generate as CallableFunction)({
		input_features: full([1, 80, 3000], 0.0),
		max_new_tokens: 1
	});

	self.postMessage({ status: "ready" });
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

}

self.addEventListener("message", async (e: MessageEvent) => {
	const { type, data } = e.data;

	switch (type) {
		case "load":
			await load();
			break;
		case "generate":
			await generate(data);
			break;
		case "search":
			await search(data);
			break;
	}
});
