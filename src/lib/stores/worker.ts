export type MessageEventHandler = (event: MessageEvent) => void;

export function createWorker(messageEventHandler: MessageEventHandler): Worker {
	const worker = new Worker(new URL("../worker.ts", import.meta.url), {
		type: "module"
	});
	worker.addEventListener("message", messageEventHandler);
	return worker;
}
