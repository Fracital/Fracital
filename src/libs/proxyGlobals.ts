/**
 * Vendor-global names assembled from pieces. The pieces are ordinary string
 * literals, which the build obfuscator encrypts; the assembled name never
 * appears in plaintext in the shipped bundle, but at runtime it resolves to
 * the exact global the vendored proxy runtime publishes.
 */

export const RUNTIME_GLOBAL = ["$", "scram", "jet"].join("");

/** The vendored engine's global (version info, config), or undefined pre-boot. */
export function runtimeGlobal<T = { versionInfo?: { version?: string } }>(): T | undefined {
	return (globalThis as Record<string, unknown>)[RUNTIME_GLOBAL] as T | undefined;
}
