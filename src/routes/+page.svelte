<script lang="ts">
	import Icon from '@iconify/svelte';
	import { MAX_SAMPLES, transcriber, WHISPER_SAMPLING_RATE } from '$lib/stores/transcriber.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { getAyahMetasForSurah } from 'quran-meta/hafs';
	import type { AyahMeta, Surah } from 'quran-meta';
	import { lpad, removeDiacritics } from '$lib/utils/strings';

	let listening = $state<boolean>(false);
	let stream = $state<MediaStream | null>(null);
	let recorder: MediaRecorder | null = null;
	let audioContext: AudioContext | null = null;
	let chunks: Blob[] = [];

	async function processChunks() {
		if (!recorder || !listening || transcriber.state !== 'ready') {
			return;
		}
		if (chunks.length > 0) {
			const blob = new Blob(chunks, { type: recorder.mimeType });
			const arrayBuffer = await blob.arrayBuffer();
			const decoded = await audioContext!.decodeAudioData(arrayBuffer);
			let audio = decoded.getChannelData(0);

			if (audio.length > MAX_SAMPLES) {
				audio = audio.slice(-MAX_SAMPLES);
			}

			transcriber.start(audio);
			recorder?.requestData();
		} else {
			recorder?.requestData();
		}
	}

	async function startListening() {
		if (listening) return;

		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		recorder = new MediaRecorder(stream);
		audioContext = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });

		recorder.onstart = () => {
			listening = true;
			chunks = [];
			recorder?.requestData();
		};

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				chunks.push(e.data);
				processChunks();
			} else {
				setTimeout(() => recorder?.requestData(), 25);
			}
		};

		recorder.onstop = () => {
			listening = false;
		};

		recorder.start();
	}

	async function stopListening() {
		recorder?.stop();
		stream?.getTracks().forEach((track) => track.stop());
		audioContext?.close();
		recorder = null;
		audioContext = null;
		stream = null;
		chunks = [];
	}

	let surahMeta = $state<AyahMeta[] | null>(null);
	let page = $state<number | null>(null);
	onMount(() => {
		transcriber.load(() => {
			startListening();
		});
		transcriber.onComplete((text) => {
			if (text) transcriber.search(text);
		});
		transcriber.onSearchComplete(() => {
			// console.log('%c%s %s %s', 'color: lime', transcriber.result?.surah, transcriber.result?.ayah, $state.snapshot(transcriber.result?.text));
			if (transcriber.result?.surah) {
				surahMeta = getAyahMetasForSurah((transcriber.result?.surah ?? 0) as Surah);
				if (surahMeta) page = surahMeta.find((m) => m.ayah === transcriber.result?.ayah)?.page ?? null;
			}
		});
	});
	onDestroy(() => {
		stopListening();
	});

	let style: HTMLLinkElement | null = null;
	$effect(() => {
		if (!style) {
			style = document.createElement('style') as HTMLLinkElement;
			document.head.appendChild(style);
		}
		style.innerText = `
			.quran-madina-html-${lpad(transcriber.result?.surah?.toString() ?? '', 3, '0')}-${lpad(transcriber.result?.ayah?.toString() ?? '', 3, '0')} {
				color: #1e88e5;
			}
		`;
		return () => {
			if (style) style.innerText = '';
		};
	});
</script>

<svelte:head>
	<script data-font-size="16" src="/quran-madina-html.js" type="text/javascript"></script>
</svelte:head>

<div class="card bg-base-100 w-xl m-auto my-10 shadow-sm">
	<div class="card-body">
		<h2 class="card-title">Follow The Quran</h2>
		<p>A web app to follow the Quran recitations automatically.</p>
		<div>
			<button class="btn btn-primary" onclick={() => transcriber.load()}>
				<Icon icon="mdi:robot" />
				Load AI models
			</button>
		</div>
		<div class="card-actions justify-end">
			<button class="btn btn-success" disabled={listening || transcriber.state !== 'ready'} onclick={startListening}>
				<Icon icon="mdi:microphone" />
				Start listening
			</button>
			<button class="btn btn-error" disabled={!listening} onclick={stopListening}>
				<Icon icon="mdi:stop" />
				Stop
			</button>
		</div>
		<div class="flex flex-col gap-4 mt-10">
			{#each transcriber.progressItems as item (item.file)}
				<div class="flex flex-col">
					<div class="font-mono">
						{item.file} ({item.progress?.toFixed(2) ?? 0}%) - {item.status}
					</div>
					<progress class="progress progress-accent" value={item.progress} max="100"></progress>
				</div>
			{/each}
		</div>
		{#key page}
			<div class="flex justify-center text-black" class:hidden={!page}>
				<quran-madina-html {page}></quran-madina-html>
			</div>
		{/key}
	</div>
</div>
