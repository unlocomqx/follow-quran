<script lang="ts">
	import Icon from '@iconify/svelte';
	import { MAX_SAMPLES, transcriber } from '$lib/stores/transcriber.svelte';

	let listening = $state<boolean>(false);
	let buffer: Float32Array = [];
	let audioContext: AudioContext | null = null;
	let stream: MediaStream | null = null;

	async function startListening() {
		if (listening) return;
		listening = true;
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		audioContext = new AudioContext();
		const source = audioContext.createMediaStreamSource(stream);

		await audioContext.audioWorklet.addModule(
			new URL('$lib/audio-processor.ts', import.meta.url)
		);

		const worklet = new AudioWorkletNode(audioContext, 'audio-processor');
		worklet.port.onmessage = (event) => {
			if (!listening) {
				return;
			}
			listening = true;
			if (!transcriber.is_ready()) {
				return;
			}

			buffer = new Float32Array([...buffer, ...event.data]);
			console.log(buffer.length);
			if (buffer.length >= MAX_SAMPLES) {
				transcriber.start(buffer);
				buffer = new Float32Array();
			}
		};
		source.connect(worklet);
	}

	async function stopListening() {
		listening = false;
		buffer = new Float32Array();
		if (!audioContext || !stream) return;
		await audioContext.close();
		stream.getTracks().forEach((track) => track.stop());
		audioContext = null;
		stream = null;
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
