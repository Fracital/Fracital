/**
 * Paid Premium (src/server/billing.ts). Checkout and the Customer Portal are Stripe's own pages, so they
 * open in a real browser tab (not a proxied one); when the app gets focus back it re-reads the
 * subscription, so Premium shows up without waiting for Stripe's webhook.
 */
import { meFetch, refreshMe } from "./auth";

export type Plan = "monthly" | "annual";

/** Re-reads the subscription from Stripe, then the account (which fires account-upd). */
export async function syncBilling() {
	await meFetch("/api/me/billing/sync", { method: "POST" }).catch(() => undefined);
	await refreshMe();
}

let syncOnReturn: (() => void) | null = null;
function syncWhenBack() {
	if (syncOnReturn) return;
	syncOnReturn = () => {
		window.removeEventListener("focus", syncOnReturn!);
		syncOnReturn = null;
		void syncBilling();
	};
	window.addEventListener("focus", syncOnReturn);
}

/**
 * Opens a Stripe page in a new tab. The tab is opened before the request (still inside the click) so
 * popup blockers allow it, then sent to the URL the server returns.
 */
async function openStripe(path: string, body?: unknown) {
	const tab = window.open("about:blank", "_blank");
	// Stripe's page has no business reaching back into the app.
	if (tab) tab.opener = null;
	try {
		const { url } = await meFetch<{ url: string }>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
		if (tab) tab.location.href = url;
		else window.location.href = url;
		syncWhenBack();
	} catch (err) {
		tab?.close();
		throw err;
	}
}

export const startCheckout = (plan: Plan) => openStripe("/api/me/billing/checkout", { plan });
export const openBillingPortal = () => openStripe("/api/me/billing/portal");
