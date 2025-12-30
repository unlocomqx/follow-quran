const json = 'https://raw.githubusercontent.com/amrayn/quran-text/main/quran-no-tashkeel.json';

const chapters = await fetch(json).then((res) => res.json());

const verses_data = chapters
	.map((c) => {
		console.log(c.verses.length);
		return c.verses.map((v) => ({
			surah: c.id,
			ayah: v.id,
			text: v.text
		}));
	})
	.flat();

await Bun.file('static/quran.json', { type: 'application/json' }).write(
	JSON.stringify(verses_data)
);

export {};
