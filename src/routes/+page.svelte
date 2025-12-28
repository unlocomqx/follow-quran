<script lang="ts">
	import Icon from '@iconify/svelte';
	import { transcriber } from '$lib/stores/transcriber.svelte';

	let listening = $state<boolean>(false);
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
			transcriber.start(event.data);
		};
		source.connect(worklet);
	}

	async function stopListening() {
		listening = false;
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
		<div class="card-actions justify-end">
			<button class="btn btn-success" onclick={startListening} disabled={listening}>
				<Icon icon="mdi:microphone" />
				Start listening
			</button>
			<button class="btn btn-error" onclick={stopListening} disabled={!listening}>
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
	</div>
</div>
