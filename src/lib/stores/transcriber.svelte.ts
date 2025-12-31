import { createWorker } from './worker';
import Constants from '../utils/constants';
import { surahVerses } from '$lib/surah-verses';
import { removeDiacritics } from '$lib/utils/strings';

export const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 10; // seconds
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
	/** transcription state: idle, busy, loading model, or ready */
	state = $state<'idle' | 'busy' | 'loading' | 'ready'>('idle');
	/** model download progress items */
	progressItems = $state<ProgressItem[]>([]);
	/** transcription output with text and tokens per second */
	output = $state<OutputData | undefined>(undefined);
	/** search result with surah/ayah info */
	result = $state<ResultData | undefined>(undefined);
	/** current search text for filtering */
	current_search = '';
	/** current surah being read */
	current_surah = 0;
	/** current ayah being read */
	current_ayah = 0;
	/** tracks how many times each surah appears in results for switch detection */
	surahs_counter: { [key: number]: number } = {};
	/** number of consecutive hits needed to switch to a new surah */
	surah_switch_threshold = 5;
	model = $state(Constants.DEFAULT_MODEL);
	/** callback when model finishes loading */
	load_callback?: () => void;
	/** callback when transcription completes */
	complete_callback?: (text: string | undefined) => void;
	/** callback when search completes */
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
				if (result) {
					this.result = { ...result };
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

	private filterResults(results: ResultData[]): ResultData | null {
		if (!this.current_surah && !this.current_ayah) return results[0];

		const SURAH_COEFF = 10;
		const SURAH_COEFF_MAX = 0.5;
		const AYAH_COEFF = 1;

		console.log(`%c🔍 ${removeDiacritics(this.current_search)}`, 'color: lime');

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

		const sorted_results = results_with_score.sort((a, b) => b.score - a.score);
		const result = sorted_results[0];

		if (result && this.current_surah && this.current_ayah) {
			this.surahs_counter[result.surah] = (this.surahs_counter[result.surah] ?? 0) + 1;
			if (result.surah !== this.current_surah) {
				const surah_count = this.surahs_counter[result.surah] ?? 0;
				if (surah_count > this.surah_switch_threshold) {
					this.surahs_counter[result.surah] = 0;
				} else {
					return null;
				}
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

		if (result?.surah === this.current_surah && result?.ayah === this.current_ayah - 1) {
			return null;
		}

		return result;
	}
}

export const transcriber = new Transcriber();
