import {
	pipeline,
	WhisperTextStreamer,
	type AutomaticSpeechRecognitionPipeline,
	type ProgressCallback
} from "@huggingface/transformers";

interface TranscribeMessage {
	audio: Float32Array;
	model: string;
	subtask: string | null;
	language: string | null;
}

interface Chunk {
	text: string;
	timestamp: [number, number | null];
	finalised: boolean;
	offset: number;
}

class AutomaticSpeechRecognitionPipelineFactory {
	static task = "automatic-speech-recognition" as const;
	static model: string | null = null;
	static instance: AutomaticSpeechRecognitionPipeline | null = null;

	static async getInstance(
		progress_callback?: ProgressCallback
	): Promise<AutomaticSpeechRecognitionPipeline> {
		if (this.instance === null) {
			// @ts-expect-error complex union type
			this.instance = await pipeline(this.task, this.model!, {
				dtype: {
					encoder_model: this.model === "onnx-community/whisper-large-v3-turbo" ? "fp16" : "fp32",
					decoder_model_merged: "q4"
				},
				device: "webgpu",
				progress_callback
			});
		}
		return this.instance;
	}
}

self.addEventListener("message", async (event: MessageEvent<TranscribeMessage>) => {
	const transcript = await transcribe(event.data);
	if (transcript === null) return;

	self.postMessage({
		status: "complete",
		data: transcript
	});
});

const transcribe = async ({ audio, model, subtask, language }: TranscribeMessage) => {
	const isDistilWhisper = model.startsWith("distil-whisper/");
	const p = AutomaticSpeechRecognitionPipelineFactory;

	if (p.model !== model) {
		p.model = model;
		if (p.instance !== null) {
			await p.instance.dispose();
			p.instance = null;
		}
	}

	const transcriber = await p.getInstance((data) => {
		self.postMessage(data);
	});

	const time_precision =
		(transcriber.processor.feature_extractor as any).config.chunk_length /
		(transcriber.model.config as any).max_source_positions;

	const chunks: Chunk[] = [];
	const chunk_length_s = isDistilWhisper ? 20 : 30;
	const stride_length_s = isDistilWhisper ? 3 : 5;

	let chunk_count = 0;
	let start_time: number | null = null;
	let num_tokens = 0;
	let tps: number | undefined;

	// @ts-expect-error tokenizer type mismatch
	const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
		time_precision,
		on_chunk_start: (x: number) => {
			const offset = (chunk_length_s - stride_length_s) * chunk_count;
			chunks.push({
				text: "",
				timestamp: [offset + x, null],
				finalised: false,
				offset
			});
		},
		token_callback_function: () => {
			start_time ??= performance.now();
			if (num_tokens++ > 0) {
				tps = (num_tokens / (performance.now() - start_time)) * 1000;
			}
		},
		callback_function: (x: string) => {
			const current = chunks.at(-1);
			if (!current) return;
			current.text += x;

			self.postMessage({
				status: "update",
				data: { text: "", chunks, tps }
			});
		},
		on_chunk_end: (x: number) => {
			const current = chunks.at(-1);
			if (!current) return;
			current.timestamp[1] = x + current.offset;
			current.finalised = true;
		},
		on_finalize: () => {
			start_time = null;
			num_tokens = 0;
			++chunk_count;
		}
	});

	const output = await transcriber(audio, {
		top_k: 0,
		do_sample: false,
		chunk_length_s,
		stride_length_s,
		language: language ?? undefined,
		task: subtask ?? undefined,
		return_timestamps: true,
		force_full_sequences: false,
		streamer
	}).catch((error) => {
		console.error(error);
		self.postMessage({ status: "error", data: error });
		return null;
	});

	return output ? { tps, ...output } : null;
};
