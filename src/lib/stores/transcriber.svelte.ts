import { createWorker } from './worker';
import Constants from '../utils/constants';
import { surahVerses } from '$lib/surah-verses';

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
	score?: number;
	text?: string;
}

export class Transcriber {
	state = $state<'idle' | 'busy' | 'loading' | 'ready'>('idle');
	progressItems = $state<ProgressItem[]>([]);
	output = $state<OutputData | undefined>(undefined);
	result = $state<ResultData | undefined>(undefined);
	current_search = '';
	current_surah = 0;
	current_ayah = 0;
	model = $state(Constants.DEFAULT_MODEL);
	load_callback?: () => void;
	complete_callback?: (text: string | undefined) => void;
	search_complete_callback?: () => void;

	private worker: Worker;

	constructor() {
		this.worker = createWorker(this.onMessage.bind(this));
	}

	load(cb?: () => void) {
		this.load_callback = cb;
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
				this.load_callback?.();
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

			case 'search_complete': {
				const result = this.filterResults(message.results as ResultData[]);
				this.result = { ...result };
				if (result) {
					this.current_surah = result.surah;
					this.current_ayah = result.ayah;
				}
				this.search_complete_callback?.();
				break;
			}
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
		this.current_search = text;
		this.worker.postMessage({
			type: 'search',
			data: {
				text,
				current_surah: this.current_surah
			}
		});
	}

	private filterResults(results: ResultData[]): ResultData {
		if (!this.current_surah && !this.current_ayah) return results[0];

		const SURAH_COEFF = 10;
		const SURAH_COEFF_MAX = 0.5;
		const AYAH_COEFF = 1;

		// console.log(`🔍 ${this.current_search}`);

		const results_with_score = results
			.map((result) => {
				const nb_verses = surahVerses[result.surah] || 0;
				const weight =
					Math.min(
						(SURAH_COEFF * Math.abs(result.surah - (this.current_surah ?? 0))) / 144,
						SURAH_COEFF_MAX
					) +
					(AYAH_COEFF * Math.abs(result.ayah - (this.current_ayah ?? 0) + 1)) / nb_verses / 144;
				console.log(`${result.score} - ${weight} = ${result.score! - weight} (${result.text})`);
				return {
					...result,
					score: result.score! - weight,
					weight
				};
			})
			.filter((v) => v.score > 0.85);

		let sorted_results = results_with_score.sort((a, b) => b.score - a.score);
		const result = sorted_results[0];

		if (result && this.current_surah && this.current_ayah) {
			if (result.surah !== this.current_surah) {
				console.log(`%cDifferent surah`, 'color: red');
			}

			if (Math.abs(result.ayah - this.current_ayah) > 1) {
				console.log(`%cDifferent ayah`, 'color: orange');
			}
		}

		const second_result = sorted_results[1];
		if (
			second_result?.score >= 0.9 &&
			second_result?.surah === this.current_surah &&
			second_result.ayah - this.current_ayah === 1
		) {
			console.log(`%cSecond result`, 'color: cyan');
			return second_result;
		}

		return result;
	}
}

export const transcriber = new Transcriber();
