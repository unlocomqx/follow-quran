import { createWorker } from './worker';
import Constants from '../utils/constants';

interface ProgressItem {
	file: string;
	loaded: number;
	progress: number;
	total: number;
	name: string;
	status: string;
}

interface TranscriberUpdateData {
	data: {
		text: string;
		chunks: { text: string; timestamp: [number, number | null] }[];
		tps: number;
	};
}

export interface TranscriberData {
	isBusy: boolean;
	tps?: number;
	text: string;
	chunks: { text: string; timestamp: [number, number | null] }[];
}

export class Transcriber {
	state = $state<'idle' | 'busy' | 'loading'>('idle');
	progressItems = $state.raw<ProgressItem[]>([]);
	output = $state<TranscriberData | undefined>(undefined);
	model = $state(Constants.DEFAULT_MODEL);
	multilingual = $state(Constants.DEFAULT_MULTILINGUAL);
	subtask = $state(Constants.DEFAULT_SUBTASK);
	language = $state<string | undefined>(Constants.DEFAULT_LANGUAGE);

	private worker: Worker;

	constructor() {
		this.worker = createWorker(this.onMessage.bind(this));
	}

	private onMessage(event: MessageEvent) {
		const message = event.data;
		switch (message.status) {
			case 'progress':
				console.log(message.file);
				this.progressItems = this.progressItems.map((item) =>
					item.file === message.file ? { ...item, progress: message.progress } : item
				);
				break;

			case 'update':
			case 'complete': {
				const busy = message.status === 'update';
				const updateMessage = message as TranscriberUpdateData;
				this.output = {
					isBusy: busy,
					text: updateMessage.data.text,
					tps: updateMessage.data.tps,
					chunks: updateMessage.data.chunks
				};
				this.state = busy ? 'busy' : 'idle';
				break;
			}

			case 'initiate':
				this.state = 'loading';
				this.progressItems = [...this.progressItems, message];
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
			audio,
			model: this.model,
			multilingual: this.multilingual,
			subtask: this.multilingual ? this.subtask : null,
			language: this.multilingual && this.language !== 'auto' ? this.language : null
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
