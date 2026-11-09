import { type EncryptionSession, encryptText } from "./crypto-utils.js";

// Strings registered here ship ONLY as AES-CBC ciphertext in the app shell's
// __FRX_STRINGS__ map (the map itself is then ChaCha-encrypted again by the
// post-build obfuscator). HolyText-family components look strings up here and
// reveal them into shadow DOM at runtime; bots keep dash placeholders.
//
// Add a string when it identifies the app (brand, auth copy, product labels).
// Keep it to strings that are actually rendered — every entry is baked into
// every shell.
export const DEFAULT_OBFUSCATED_STRINGS: string[] = [
	"Fracital",
	"FRACITAL",
	"Sign in to Fracital",
	"© Fracital 2026",
	"Sign in with your Fracital Account — or create one — to claim your artist page, customize it, see your stats and bring your team.",
	"Fracital Account",
	"Fracital Music",
	"Fracital for Artists",
	"Official Fracital game store",
	"Create a Fracital Account",
	"Sync your settings and build your library from Last.fm.",

	// View titles and primary navigation
	"Home",
	"Games",
	"Music",
	"Settings",
	"Account",
	"Library",
	"Files",
	"Admin",
	"Admin dashboard",
	"Admin Dashboard",

	// Auth copy
	"Sign in",
	"Create account",
	"Register",
	"Log out",
	"Loading…",
	"Sign-in methods",
	"Sign in with Terbium",
	"Reset your password",
	"Sign in with an admin account to use the dashboard.",

	// Library / music copy
	"Your Library",
	"Browse Music",
	"Build your library from Last.fm",
	"Connect Last.fm",
	"Last.fm",
	"Currently playing",
	"Artist Pick",
	"Claim your artist page",

	// Settings copy
	"Appearance",
	"Connected services",
];

export function buildEncryptedStringMap(session: EncryptionSession, extraStrings: string[] = []): Record<string, string> {
	const map: Record<string, string> = {};
	const allStrings = Array.from(new Set([...DEFAULT_OBFUSCATED_STRINGS, ...extraStrings]));

	for (const str of allStrings) {
		map[str] = encryptText(str, session);
	}

	return map;
}
