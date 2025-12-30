export function lpad(str: string, len: number, pad: string = ' '): string {
	return str.length >= len ? str : pad.repeat(len - str.length) + str;
}
