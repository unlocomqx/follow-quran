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

interface OutputData {
	text: string;
	tps?: number;
}

interface ResultData {
	surah: number;
	ayah: number;
}

export class Transcriber {
	state = $state<'idle' | 'busy' | 'loading' | 'ready'>('idle');
	progressItems = $state<ProgressItem[]>([]);
	output = $state<OutputData | undefined>(undefined);
	result = $state<ResultData | undefined>(undefined);
	model = $state(Constants.DEFAULT_MODEL);
	complete_callback?: (text: string | undefined) => void;
	search_complete_callback?: () => void;

	current_surah = $state<number | undefined>(undefined);
	current_ayah = $state<number | undefined>(undefined);

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
			case 'initiate':
				this.state = 'loading';
				if (!this.progressItems.some((item) => item.file === message.file)) {
					this.progressItems.push(message);
				}
				break;

			case 'progress':
				this.state = 'loading';
				this.progressItems.map((item) => {
					if (item.file === message.file) {
						item.progress = message.progress;
					}
				});
				break;

			case 'ready':
				this.state = 'ready';
				break;

			case 'done':
				this.progressItems = this.progressItems.filter((item) => item.file !== message.file);
				break;

			case 'error':
				this.state = 'idle';
				alert(`Error: "${message.data.message}"`);
				break;

			case 'complete':
				this.output = { text: message.output.join(' '), tps: message.tps };
				this.complete_callback?.(this.output?.text);
				break;

			case 'search_complete':
				this.result = { surah: message.surah, ayah: message.ayah };
				this.search_complete_callback?.();
				break;
		}
	}

	onComplete(cb: (text: string | undefined) => void) {
		this.complete_callback = cb;
	}

	onSearchComplete(cb: () => void) {
		this.search_complete_callback = cb;
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
				text,
				current_surah: this.current_surah
			}
		});
	}
}

export const transcriber = new Transcriber();
