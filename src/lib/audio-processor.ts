declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Map<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

class AudioProcessor extends AudioWorkletProcessor {
	process(inputs: Float32Array[][]) {
		const input = inputs[0]?.[0];
		if (input) this.port.postMessage(input);
		return true;
	}
}

registerProcessor("audio-processor", AudioProcessor);
