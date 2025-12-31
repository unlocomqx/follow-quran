export interface Verse {
	surah: number;
	ayah: number;
	text: string;
}

export interface SearchResult extends Verse {
	score: number;
}

export function searchQuran(
	verses: Verse[],
	query: string,
	current_surah?: number,
	topK = 10
): SearchResult[] {
	return verses
		.filter((verse) => !current_surah || verse.surah === current_surah)
		.map((verse, index) => ({
			...verse,
			score: phraseMatchScore(query, combineVerses(verses, index))
		}))
		.filter((v) => v.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

export function phraseMatchScore(query: string, text: string): number {
	const queryWords = query.split(/\s+/);

	if (text.includes(query)) {
		return 1 + query.length / text.length;
	}

	const textWords = text.split(/\s+/);
	let matchedWords = 0;
	let consecutiveBonus = 0;
	let lastMatchIdx = -2;

	for (const qWord of queryWords) {
		const idx = textWords.findIndex((tWord) => tWord.includes(qWord) || qWord.includes(tWord));
		if (idx !== -1) {
			matchedWords++;
			if (idx === lastMatchIdx + 1) consecutiveBonus += 0.2;
			lastMatchIdx = idx;
		}
	}

	if (matchedWords === 0) return 0;

	const wordScore = matchedWords / queryWords.length;
	const lengthPenalty = Math.min(1, query.length / text.length);

	return wordScore * 0.7 + consecutiveBonus + lengthPenalty * 0.1;
}

export function combineVerses(verses: Verse[], index: number): string {
	const verse = verses[index];
	const nextVerse = verses[index + 1];
	const nextText = nextVerse?.text || '';
	return `${verse.text} ${nextText}`;
}
