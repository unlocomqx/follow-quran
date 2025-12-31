import { describe, it, expect } from 'vitest';
import { searchQuran, phraseMatchScore, combineVerses, type Verse } from './search';

const exampleVerses: Verse[] = [
	{ surah: 1, ayah: 1, text: 'بسم الله الرحمن الرحيم' },
	{ surah: 1, ayah: 2, text: 'الحمد لله رب العالمين' },
	{ surah: 1, ayah: 3, text: 'الرحمن الرحيم' },
	{ surah: 2, ayah: 1, text: 'الم' },
	{ surah: 2, ayah: 2, text: 'ذلك الكتاب لا ريب فيه هدى للمتقين' }
];

describe('phraseMatchScore', () => {
	it('returns > 1 for exact match', () => {
		const score = phraseMatchScore('الحمد لله', 'الحمد لله رب العالمين');
		expect(score).toBeGreaterThan(1);
	});

	it('returns 0 for no match', () => {
		const score = phraseMatchScore('xyz abc', 'الحمد لله');
		expect(score).toBe(0);
	});

	it('returns partial score for word overlap', () => {
		const score = phraseMatchScore('الحمد العالمين', 'الحمد لله رب العالمين');
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThan(1);
	});

	it('gives consecutive bonus', () => {
		const consecutive = phraseMatchScore('الحمد لله', 'الحمد لله رب العالمين');
		const nonConsecutive = phraseMatchScore('الحمد العالمين', 'الحمد لله رب العالمين');
		expect(consecutive).toBeGreaterThan(nonConsecutive);
	});
});

describe('combineVerses', () => {
	it('combines current and next verse', () => {
		const combined = combineVerses(exampleVerses, 0);
		expect(combined).toBe('بسم الله الرحمن الرحيم الحمد لله رب العالمين');
	});

	it('handles last verse', () => {
		const combined = combineVerses(exampleVerses, 4);
		expect(combined).toBe('ذلك الكتاب لا ريب فيه هدى للمتقين ');
	});
});

describe('searchQuran', () => {
	it('returns results sorted by score', () => {
		const results = searchQuran(exampleVerses, 'الرحمن الرحيم');
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
	});

	it('filters by surah when specified', () => {
		const results = searchQuran(exampleVerses, 'الرحمن', 1);
		expect(results.every((r) => r.surah === 1)).toBe(true);
	});

	it('respects topK limit', () => {
		const results = searchQuran(exampleVerses, 'الله', undefined, 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it('returns empty for empty verses', () => {
		const results = searchQuran([], 'الحمد لله');
		expect(results.length).toBe(0);
	});
});
