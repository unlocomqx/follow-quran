<script lang="ts">
	import Icon from '@iconify/svelte';
	import { MAX_SAMPLES, transcriber, WHISPER_SAMPLING_RATE } from '$lib/stores/transcriber.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { getAyahMeta, getAyahMetasForSurah, getList } from 'quran-meta/hafs';
	import type { AyahMeta, Surah } from 'quran-meta';
	import { lpad } from '$lib/utils/strings';
	import { fade } from 'svelte/transition';
	import prettyBytes from 'pretty-bytes';

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
	let page = $state<number | null>(1);
	onMount(() => {
		transcriber.checkCached();
		transcriber.onComplete((text) => {
			if (text) transcriber.search(text);
		});
		transcriber.onSearchComplete(() => {
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

	const surahs = getList('surah');
	let current_start_ayah = $state(1);
</script>

<svelte:head>
	<script data-font-size="16" src="/quran-madina-html.js" type="text/javascript"></script>
</svelte:head>

<div class="relative max-w-sm mx-auto h-screen flex flex-col gap-2 items-center justify-center">
	{#if transcriber.state !== 'ready'}
		<div class="card bg-base-100 m-auto my-10 shadow-sm">
			<div class="card-body">
				<div dir="rtl" class="flex flex-col gap-4 justify-center">
					<h2 class="card-title mx-auto">إتّبع القُرآن</h2>
					<p class="text-center">تطبيق يتابع تلاوات القرآن تلقائياً.</p>
					<button class="btn btn-primary" disabled={transcriber.state === 'loading'} onclick={() => transcriber.load()}>
						<Icon icon="mdi:robot" />
						تحميل نماذج الذكاء الاصطناعي
					</button>
					<span class="text-accent text-xs font-mono text-center">
						الحجم الجملي
						<span dir="ltr">{prettyBytes(200 * 1024 * 1024)}</span>
					</span>
				</div>
				{#if transcriber.progressItems.length}
					<div class="flex flex-col gap-4 mt-10">
						{#each transcriber.progressItems as item (item.file)}
							<div class="flex flex-col" transition:fade={{duration: 500}}>
								<div class="text-xs font-mono text-center">
									<div>{item.file}</div>
									{#if item.loaded && item.total}
										<div>({prettyBytes(item.loaded)} / {prettyBytes(item.total)})</div>
									{/if}
								</div>
								<progress class="progress progress-accent" value={item.progress} max="100"></progress>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="absolute bottom-4 right-4">
			{#if !listening}
				<button class="btn btn-success" disabled={transcriber.state !== 'ready'} onclick={startListening}>
					<Icon icon="mdi:microphone" />
				</button>
			{:else}
				<button class="btn btn-warning" onclick={stopListening}>
					<Icon icon="mdi:pause" />
				</button>
			{/if}
		</div>
		<select bind:value={current_start_ayah} dir="rtl" class="text-black w-xs"
						onchange={() => {
							const ayah = getAyahMeta(current_start_ayah)
							if(ayah?.page) page = ayah.page;
						}}>
			{#each surahs as [startAyahId, ayahCount, surahOrder, rukuCount, name, isMeccan], index (startAyahId)}
				{#if name}
					<option value={startAyahId}>{index} - {name}</option>
				{/if}
			{/each}
		</select>
		{#key page}
			<div class="flex justify-center text-black" class:hidden={!page}>
				<quran-madina-html {page}></quran-madina-html>
			</div>
			{#if !page}
				<p class="text-center">
					<span class="loading loading-dots loading-xs"></span> الصفحة قيد التنزيل
				</p>
			{/if}
		{/key}
	{/if}
</div>
