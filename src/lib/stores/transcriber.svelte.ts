import { createWorker } from './worker';
import Constants from '../utils/constants';

export const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 5; // seconds
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

interface OutputData {
	text: string;
	tps?: number;
}

export class Transcriber {
	state = $state<'idle' | 'busy' | 'loading' | 'ready'>('idle');
	progressItems = $state<ProgressItem[]>([]);
	output = $state<OutputData | undefined>(undefined);
	model = $state(Constants.DEFAULT_MODEL);
	complete_callback?: (text: string | undefined) => void;

	private worker: Worker;

	constructor() {
		this.worker = createWorker(this.onMessage.bind(this));
	}

	load() {
		this.worker.postMessage({ type: 'load' });
	}

	private onMessage(event: MessageEvent) {
		const message = event.data;
		switch (message.status) {
			case 'progress':
				this.state = 'loading';
				this.progressItems.map((item) => {
					if (item.file === message.file) {
						item.progress = message.progress;
					}
				});
				break;

			case 'complete': {
				this.output = { text: message.output.join(' '), tps: message.tps };
				this.complete_callback?.(this.output?.text);
				break;
			}

			case 'initiate':
				this.state = 'loading';
				if (!this.progressItems.some((item) => item.file === message.file)) {
					this.progressItems.push(message);
				}
				break;

			case 'ready':
				this.state = 'ready';
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

	onComplete(cb: (text: string | undefined) => void) {
		this.complete_callback = cb;
	}

	start(audio: Float32Array) {
		if (!audio) return;

		this.worker.postMessage({
			type: 'generate',
			data: {
				audio,
				language: 'ar'
			}
		});
	}

	search(text: string) {
		this.worker.postMessage({
			type: 'search',
			data: {
				text
			}
		});
	}
}

export const transcriber = new Transcriber();
