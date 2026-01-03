import { createWorker } from './worker';
import Constants from '../utils/constants';
import { removeDiacritics } from '$lib/utils/strings';
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

	checkCached() {
		this.worker.postMessage({ type: 'check_cached' });
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
				this.progressItems = this.progressItems.map((item) => item.file === message.file ? {...item, ...message} : item);
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

		console.log(`%c🔍 ${removeDiacritics(this.current_search)}`, 'color: lime');

		const with_score = results
			.map((result) => {
				const nb_verses = surahVerses[this.current_surah] || 1;

				const current_ayah = this.current_surah ?? 0;
				let surah_distance = Math.abs(result.surah - current_ayah);
				const distance_to_end = nb_verses - current_ayah;
				if (distance_to_end < 3) surah_distance -= 1;
				const surah_weight = surah_distance > 0 ? 0.3 : 0;

				const same_surah = result.surah === current_ayah;
				const ayah_distance = result.ayah - (current_ayah + 1); // gives next ayah less weight
				const ayah_weight = ayah_distance > 0 ? ayah_distance / (nb_verses - current_ayah) : 1;
				return {
					...result,
					score: result.score! - surah_weight - (same_surah ? ayah_weight : 0)
				};
			})
			.sort((a, b) => b.score - a.score);

		for (const result of with_score.filter(s => s.score > 0.1)) {
			console.log('%c%s', 'color: #ffeb3b', `${result.surah}:${result.ayah}`, result.text, result.score);
		}

		const next_ayah = with_score.find((r) => r.ayah === this.current_ayah + 1);
		if (next_ayah) {
			console.log(`%c➡️ Next ayah ${next_ayah.surah}:${next_ayah.ayah}`, 'color: red');
			return next_ayah;
		}

		const high_scores = with_score.filter((r) => r.score > 0.85);

		const first_result = high_scores[0];
		if (!first_result) return null;

		// keep current ayah
		if (first_result.ayah === this.current_ayah - 1) {
			console.log(
				`%c➡️ Keep current ayah ${first_result.surah}:${this.current_ayah}`,
				'color: #ff5722'
			);
			return null;
		}

		const same_surah = high_scores.find((r) => r.surah === first_result?.surah);
		if (same_surah) {
			console.log(`%c➡️ Same surah ${same_surah.surah}:${same_surah.ayah}`, 'color: #ff5722');
			return same_surah;
		}

		console.log(`%c✅ ${first_result?.text}`, 'color: cyan');
		if (first_result?.surah !== this.current_surah) {
			console.log(
				`%c🔍 Different surah: ${first_result?.surah} / ${this.current_surah}`,
				'color: magenta'
			);
		}

		return first_result;
	}
}

export const transcriber = new Transcriber();
