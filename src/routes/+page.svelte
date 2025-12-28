<script lang="ts">
	import Icon from '@iconify/svelte';
	import { MAX_SAMPLES, transcriber } from '$lib/stores/transcriber.svelte';

	const WHISPER_SAMPLING_RATE = 16_000;

	let listening = $state<boolean>(false);
	let stream = $state<MediaStream | null>(null);
	let recorder: MediaRecorder | null = null;
	let audioContext: AudioContext | null = null;
	let chunks: Blob[] = [];

	async function processChunks() {
		if (!recorder || !listening || !transcriber.is_ready()) return;

		if (chunks.length > 0) {
			const blob = new Blob(chunks, { type: recorder.mimeType });
			const arrayBuffer = await blob.arrayBuffer();
			const decoded = await audioContext!.decodeAudioData(arrayBuffer);
			let audio = decoded.getChannelData(0);

			console.log(audio.length);

			if (audio.length > MAX_SAMPLES) {
				audio = audio.slice(-MAX_SAMPLES);
			}

			transcriber.start(audio);
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
			console.log('recorder started');
			listening = true;
			chunks = [];
		};

		recorder.ondataavailable = (e) => {
			console.log('data available', e.data.size);
			if (e.data.size > 0) {
				chunks.push(e.data);
				processChunks();
			} else {
				setTimeout(() => recorder?.requestData(), 25);
			}
		};

		recorder.onstop = () => {
			console.log('recorder stopped');
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
</script>

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
			<button class="btn btn-success" disabled={listening} onclick={startListening}>
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

		== {transcriber.output?.output} ==
	</div>
</div>
