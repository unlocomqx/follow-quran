<script lang="ts">
	function start_listening() {
		navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
			const audioContext = new AudioContext();
			const source = audioContext.createMediaStreamSource(stream);
			const processor = audioContext.createScriptProcessor(1024, 1, 1);
			source.connect(processor);
			processor.connect(audioContext.destination);
			processor.onaudioprocess = (event) => {
				const inputBuffer = event.inputBuffer.getChannelData(0);
				console.log(inputBuffer);
			};
		});
	}
</script>
<div class="card bg-base-100 w-xl m-auto my-10 shadow-sm">
	<div class="card-body">
		<h2 class="card-title">Follow The Quran</h2>
		<p>A web app to follow the Quran recitations automatically.</p>
		<div class="card-actions justify-end">
			<button class="btn btn-primary" onclick={() =>start_listening()}>Start listening</button>
		</div>
	</div>
</div>
