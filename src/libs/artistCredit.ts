/**
 * Splits combined artist credits ("Drake & 21 Savage", "SZA feat. Kendrick Lamar")
 * into individual names without breaking artists whose names contain separators,
 * like "Tyler, The Creator" or "Earth, Wind & Fire".
 */

/** Well-known artists whose names contain a credit separator (",", "&", "with", " x "). */
const BUILT_IN_NAMES = [
	"Tyler, The Creator",
	"Earth, Wind & Fire",
	"Crosby, Stills, Nash & Young",
	"Crosby, Stills & Nash",
	"Emerson, Lake & Palmer",
	"Blood, Sweat & Tears",
	"Peter, Paul and Mary",
	"Simon & Garfunkel",
	"Hall & Oates",
	"Daryl Hall & John Oates",
	"Mumford & Sons",
	"Florence + The Machine",
	"Florence & The Machine",
	"Chase & Status",
	"Echo & the Bunnymen",
	"Belle & Sebastian",
	"Sly & the Family Stone",
	"Kool & the Gang",
	"Iron & Wine",
	"Angus & Julia Stone",
	"Hootie & the Blowfish",
	"Marina & the Diamonds",
	"Siouxsie and the Banshees",
	"Bob Marley & The Wailers",
	"Prince & The Revolution",
	"Huey Lewis & The News",
	"Derek & the Dominos",
	"Joan Jett & the Blackhearts",
	"Tom Petty & the Heartbreakers",
	"Martha & the Vandellas",
	"Smokey Robinson & The Miracles",
	"Ike & Tina Turner",
	"Brooks & Dunn",
	"Big & Rich",
	"Dan + Shay",
	"Sam & Dave",
	"Ashford & Simpson",
	"Peaches & Herb",
	"Captain & Tennille",
	"Sonny & Cher",
	"Eric B. & Rakim",
	"DJ Jazzy Jeff & The Fresh Prince",
	"Grandmaster Flash & The Furious Five",
	"Nico & Vinz",
	"Macklemore & Ryan Lewis",
	"Years & Years",
	"Above & Beyond",
	"Axwell & Ingrosso",
	"Tyler & Ezra",
];

/** Artist names learned at runtime (search results, artist pages) — protects unlisted names too. */
const learnedNames = new Set<string>();

/** Teaches the splitter artist names seen in catalog data so their commas/ampersands aren't split on. */
export function rememberArtistNames(names: Iterable<string | undefined | null>): void {
	for (const name of names) {
		if (name && /,|&|\bwith\b|\s+x\s+|\+/i.test(name)) learnedNames.add(name.trim());
	}
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEPARATOR = /\s*(?:,|&|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bfeaturing\b|\bwith\b|\bvs\.?(?=\s))\s*/i;
// " x " only separates in lowercase between spaces, so "Lil Nas X" and "Malcolm X" stay intact.
const X_SEPARATOR = /\s+x\s+/;

export function splitArtistCredit(credit: string, knownNames: Iterable<string> = []): string[] {
	if (!credit) return [];
	// Longest names first so "Crosby, Stills, Nash & Young" wins over "Crosby, Stills & Nash".
	const protectedNames = [...new Set([...BUILT_IN_NAMES, ...learnedNames, ...knownNames])].filter(Boolean).sort((a, b) => b.length - a.length);

	const placeholders: string[] = [];
	let masked = credit;
	for (const name of protectedNames) {
		const pattern = new RegExp(`(^|[\\s,&(])(${escapeRegex(name)})(?=$|[\\s,&)])`, "gi");
		masked = masked.replace(pattern, (_m, lead: string, match: string) => {
			placeholders.push(match);
			return `${lead}\uE000${placeholders.length - 1}\uE000`;
		});
	}

	return masked
		.split(SEPARATOR)
		.flatMap(part => part.split(X_SEPARATOR))
		.map(part => part.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => placeholders[Number(i)]).trim())
		.filter(Boolean);
}
