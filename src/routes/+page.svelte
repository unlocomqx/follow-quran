<script lang="ts">
	import Icon from '@iconify/svelte';

	let audioContext: AudioContext | null = null;
	let stream: MediaStream | null = null;

	async function startListening() {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		audioContext = new AudioContext();
		const source = audioContext.createMediaStreamSource(stream);

		await audioContext.audioWorklet.addModule(
			new URL("$lib/audio-processor.ts", import.meta.url)
		);

		const worklet = new AudioWorkletNode(audioContext, "audio-processor");
		worklet.port.onmessage = (event) => {
			console.log('okk');
			// console.log(event.data);
		};
		source.connect(worklet);
	}

	async function stopListening() {
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
			<button class="btn btn-success" onclick={startListening}>
				<Icon icon="mdi:microphone" />
				Start listening
			</button>
			<button class="btn btn-error" onclick={stopListening}>
				<Icon icon="mdi:stop" />
				Stop
			</button>
		</div>
	</div>
</div>
