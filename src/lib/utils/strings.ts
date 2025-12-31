export function lpad(str: string, len: number, pad: string = ' '): string {
	return str.length >= len ? str : pad.repeat(len - str.length) + str;
}
export function removeDiacritics(text: string): string {
	return text.replace(/[\u064B-\u065F\u0670]/g, '');
}
