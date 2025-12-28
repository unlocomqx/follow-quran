import { createWorker } from './worker';
import Constants from '../utils/constants';

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
export const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;

interface ProgressItem {
	file: string;
	loaded: number;
	progress: number;
	total: number;
	name: string;
	status: string;
}

interface TranscriberUpdateData {
	output: string;
	tps?: number;
}

export class Transcriber {
	state = $state<'idle' | 'busy' | 'loading'>('idle');
	progressItems = $state<ProgressItem[]>([]);
	output = $state<TranscriberUpdateData | undefined>(undefined);
	model = $state(Constants.DEFAULT_MODEL);
	multilingual = $state(Constants.DEFAULT_MULTILINGUAL);
	subtask = $state(Constants.DEFAULT_SUBTASK);
	language = $state<string | undefined>(Constants.DEFAULT_LANGUAGE);

	private worker: Worker;

	constructor() {
		this.worker = createWorker(this.onMessage.bind(this));
	}

	load() {
		this.worker.postMessage({ type: 'load' });
	}

	private onMessage(event: MessageEvent) {
		const message = event.data;
		console.log(message.status);
		switch (message.status) {
			case 'progress':
				this.progressItems.map((item) => {
					if (item.file === message.file) {
						item.progress = message.progress;
					}
				});
				break;

			case 'update':
			case 'complete': {
				const busy = message.status === 'update';
				this.output = message;
				this.state = busy ? 'busy' : 'idle';
				break;
			}

			case 'initiate':
				this.state = 'loading';
				if (!this.progressItems.some((item) => item.file === message.file)) {
					this.progressItems.push(message);
				}
				break;

			case 'ready':
				this.state = 'idle';
				break;

			case 'error':
				this.state = 'idle';
				alert(`Error: "${message.data.message}"`);
				break;

			case 'done':
				this.progressItems = this.progressItems.filter((item) => item.file !== message.file);
				break;
		}
	}

	start(audio: Float32Array) {
		if (!audio) return;

		this.output = undefined;
		this.state = 'busy';

		this.worker.postMessage({
			type: 'generate',
			data: {
				audio,
				language: this.multilingual && this.language !== 'auto' ? this.language : null
			}
		});
	}

	clearOutput() {
		this.output = undefined;
	}

	is_ready() {
		return this.state === 'idle';
	}
}

export const transcriber = new Transcriber();
