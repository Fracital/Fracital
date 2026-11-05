declare global {
	interface Window {
		__FRX_STRINGS__?: Record<string, string>;
	}
}

const localRegistry: Record<string, string> = {};

export function registerObfuscatedString(text: string, ciphertext: string): void {
	localRegistry[text] = ciphertext;
}

export function registerObfuscatedStrings(map: Record<string, string>): void {
	Object.assign(localRegistry, map);
}

export function getObfuscatedCiphertext(text: string): string | undefined {
	if (typeof window !== "undefined" && window.__FRX_STRINGS__?.[text]) {
		return window.__FRX_STRINGS__[text];
	}
	return localRegistry[text];
}
