let capturedShadowRoot: ShadowRoot | undefined;

/**
 * Take the cloak shadow root that uncloak-client.js hands over on `window`,
 * then remove the global so it is not left exposed to other same-page scripts.
 * The first caller captures it; later callers reuse the cached value.
 */
export function getCloakShadowRoot(): ShadowRoot | undefined {
	if (typeof window === "undefined") return capturedShadowRoot;
	const holder = window as unknown as { __FRACITAL_SHADOW_ROOT__?: ShadowRoot };
	if (holder.__FRACITAL_SHADOW_ROOT__) {
		capturedShadowRoot = holder.__FRACITAL_SHADOW_ROOT__;
		try {
			delete holder.__FRACITAL_SHADOW_ROOT__;
		} catch {
			holder.__FRACITAL_SHADOW_ROOT__ = undefined;
		}
	}
	return capturedShadowRoot;
}
