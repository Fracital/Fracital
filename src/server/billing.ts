/**
 * Paid Premium through Stripe: hosted Checkout to subscribe, the Customer Portal to manage, and webhooks
 * that keep each account's subscription in fracital_billing. Premium itself is still read in one place,
 * userMeta() (artists.ts), which counts an active subscription alongside the admin toggle and the promo.
 *
 * Each account gets one Stripe Customer, stored here; events find their account through it (the
 * customer's `user_id` metadata is only a fallback). Every event re-reads the customer's subscriptions
 * from Stripe instead of trusting the event's copy, so events arriving out of order can't leave a stale
 * state behind.
 *
 * Off until STRIPE_SECRET_KEY and both prices are set (scripts/stripe-setup.mjs creates the prices,
 * the launch coupon, the portal configuration and the webhook endpoint).
 */
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Pool } from "pg";
import Stripe from "stripe";
import * as z from "zod";
import type { Env } from "./accounts.ts";
import { userMeta } from "./artists.ts";
import { ownOrigin } from "./cross-site.ts";

export type Plan = "monthly" | "annual";

/** Statuses that count as Premium. past_due keeps it while Stripe retries the card. */
export const PAID_STATUSES = ["active", "trialing", "past_due"];

let client: Stripe | null = null;
let clientKey = "";
/** The Stripe client, or null when billing isn't configured. STRIPE_API_BASE points it at a local mock. */
function stripe(): Stripe | null {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) return null;
	if (!client || clientKey !== key) {
		const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
		client = new Stripe(key, base ? { host: base.hostname, port: Number(base.port) || undefined, protocol: base.protocol.replace(":", "") as "http" | "https" } : {});
		clientKey = key;
	}
	return client;
}

const priceFor = (plan: Plan) => (plan === "annual" ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY);
const planFor = (priceId: string | undefined): Plan | null => (!priceId ? null : priceId === process.env.STRIPE_PRICE_ANNUAL ? "annual" : priceId === process.env.STRIPE_PRICE_MONTHLY ? "monthly" : null);

export const billingEnabled = () => !!(stripe() && process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_PRICE_ANNUAL);

export async function migrateBilling(pool: Pool) {
	await pool.query(`
		create table if not exists fracital_billing (
			user_id text primary key references "user"(id) on delete cascade,
			customer_id text not null unique,
			subscription_id text,
			status text,
			plan text,
			current_period_end timestamptz,
			-- When a scheduled cancellation takes effect; null while it renews.
			cancel_at timestamptz,
			updated_at timestamptz not null default now()
		);
	`);
}

/** The account's subscription, for /api/me and the Premium page. */
export async function billingSummary(pool: Pool, userId: string) {
	const { rows } = await pool.query<{ status: string | null; plan: Plan | null; current_period_end: Date | null; cancel_at: Date | null }>("select status, plan, current_period_end, cancel_at from fracital_billing where user_id = $1", [userId]);
	const row = rows[0];
	const paid = !!row?.status && PAID_STATUSES.includes(row.status);
	return {
		enabled: billingEnabled(),
		subscription: paid
			? {
					plan: row.plan,
					status: row.status,
					// Renews on current_period_end unless a cancellation is scheduled, which ends it on cancel_at.
					renewsAt: row.cancel_at ? null : (row.current_period_end?.toISOString() ?? null),
					endsAt: row.cancel_at?.toISOString() ?? null,
				}
			: null,
	};
}

/** The account a Stripe customer belongs to: our stored link, else the customer's user_id metadata. */
async function userForCustomer(pool: Pool, customerId: string): Promise<string | null> {
	const { rows } = await pool.query<{ user_id: string }>("select user_id from fracital_billing where customer_id = $1", [customerId]);
	if (rows[0]) return rows[0].user_id;
	const customer = await stripe()!.customers.retrieve(customerId);
	const userId = !customer.deleted ? customer.metadata?.user_id : undefined;
	if (!userId) return null;
	const { rowCount } = await pool.query('insert into fracital_billing (user_id, customer_id) select id, $2 from "user" where id = $1 on conflict (user_id) do nothing', [userId, customerId]);
	return rowCount ? userId : null;
}

// Paid ones first, then the newest.
const subRank = (s: Stripe.Subscription) => (PAID_STATUSES.includes(s.status) ? 0 : 1);

/** Re-reads a customer's subscriptions from Stripe and stores the one that matters. */
export async function syncCustomer(pool: Pool, customerId: string) {
	const userId = await userForCustomer(pool, customerId);
	if (!userId) {
		console.warn(`Stripe customer ${customerId} isn't linked to an account; ignoring`);
		return null;
	}
	const subs = await stripe()!.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
	const best = [...subs.data].sort((a, b) => subRank(a) - subRank(b) || b.created - a.created)[0];
	const item = best?.items.data[0];
	// The billing period lives on the item in current API versions, on the subscription in older ones.
	const periodEnd = item?.current_period_end ?? (best as unknown as { current_period_end?: number } | undefined)?.current_period_end ?? null;
	const cancelAt = best?.cancel_at ?? (best?.cancel_at_period_end ? periodEnd : null);
	await pool.query("update fracital_billing set subscription_id = $2, status = $3, plan = $4, current_period_end = to_timestamp($5), cancel_at = to_timestamp($6), updated_at = now() where user_id = $1", [userId, best?.id ?? null, best?.status ?? null, planFor(item?.price.id), periodEnd, cancelAt]);
	// Paying counts as having had premium: the launch offer is for first-timers.
	if (best && PAID_STATUSES.includes(best.status)) await pool.query("insert into fracital_user_meta (user_id, had_premium) values ($1, true) on conflict (user_id) do update set had_premium = true", [userId]);
	return userId;
}

/** Ends the account's subscriptions right away (account deletion, disputes, fraud warnings). */
export async function cancelSubscriptions(pool: Pool, customerId: string, reason: string) {
	const s = stripe();
	if (!s) return;
	const subs = await s.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
	for (const sub of subs.data) {
		if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
		await s.subscriptions.cancel(sub.id);
		console.log(`Canceled Stripe subscription ${sub.id} (${reason})`);
	}
	await syncCustomer(pool, customerId).catch(() => undefined);
}

/** Cancels a deleted account's subscription so it stops billing. Call before the user row goes. */
export async function cancelBillingForUser(pool: Pool, userId: string) {
	const { rows } = await pool.query<{ customer_id: string }>("select customer_id from fracital_billing where user_id = $1", [userId]);
	if (rows[0] && stripe()) await cancelSubscriptions(pool, rows[0].customer_id, "account deleted");
}

/** The Stripe customer behind a charge (refunds, disputes and fraud warnings carry a charge). */
async function customerOfCharge(chargeId: string | Stripe.Charge | null | undefined) {
	if (!chargeId) return null;
	const charge = typeof chargeId === "string" ? await stripe()!.charges.retrieve(chargeId) : chargeId;
	return typeof charge.customer === "string" ? charge.customer : (charge.customer?.id ?? null);
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

/** Handles one verified event. Throws to make Stripe retry. */
async function handleEvent(pool: Pool, event: Stripe.Event) {
	switch (event.type) {
		case "checkout.session.completed":
		case "checkout.session.async_payment_succeeded": {
			const session = event.data.object;
			if (session.mode === "subscription" && session.customer) await syncCustomer(pool, idOf(session.customer)!);
			return;
		}
		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted":
		case "customer.subscription.paused":
		case "customer.subscription.resumed":
			await syncCustomer(pool, idOf(event.data.object.customer)!);
			return;
		case "invoice.paid":
		case "invoice.payment_failed": {
			const customer = idOf(event.data.object.customer);
			if (customer) await syncCustomer(pool, customer);
			return;
		}
		case "charge.refunded": {
			// A refund doesn't end the subscription by itself (cancel it in the Dashboard too if that's the intent).
			const customer = await customerOfCharge(event.data.object);
			if (customer) await syncCustomer(pool, customer);
			return;
		}
		case "charge.dispute.created":
		case "radar.early_fraud_warning.created": {
			// The money is disputed or likely stolen: stop billing the card and end Premium now.
			const customer = await customerOfCharge(event.data.object.charge);
			if (customer) await cancelSubscriptions(pool, customer, event.type);
			return;
		}
		default:
			return;
	}
}

/** Runs a Stripe call for a route; a failure is logged (Stripe's message and request id, never the key) and gives null. */
async function stripeCall<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch (err) {
		const e = err as { message?: string; requestId?: string };
		console.error(`Stripe ${what} failed: ${e.message ?? err}${e.requestId ? ` (${e.requestId})` : ""}`);
		return null;
	}
}

const letters = (n: number) => Array.from(randomBytes(n), b => String.fromCharCode(97 + (b % 26))).join("");

/** The account's Stripe customer, created on first checkout. */
async function ensureCustomer(pool: Pool, user: { id: string; email: string; name: string }) {
	const { rows } = await pool.query<{ customer_id: string }>("select customer_id from fracital_billing where user_id = $1", [user.id]);
	if (rows[0]) return rows[0].customer_id;
	// Last.fm sign-ins have a placeholder address; Checkout asks for a real one instead.
	const email = user.email.endsWith("@lastfm.invalid") ? undefined : user.email;
	const customer = await stripe()!.customers.create({ email, name: user.name, metadata: { user_id: user.id } }, { idempotencyKey: `fracital-customer-${user.id}` });
	await pool.query("insert into fracital_billing (user_id, customer_id) values ($1, $2) on conflict (user_id) do nothing", [user.id, customer.id]);
	const { rows: stored } = await pool.query<{ customer_id: string }>("select customer_id from fracital_billing where user_id = $1", [user.id]);
	return stored[0].customer_id;
}

/**
 * The page Stripe sends people back to. The app opened Checkout or the portal in a window of its own,
 * so this closes it; the app re-reads the subscription when it gets focus back. Kept neutral (no
 * name, no app code): on a decoy host a plain load of it must not say what the site is. The one
 * inline line of script is the close; it's served here, not from the bundle, because it has to run
 * on Stripe's return before (and without) the app.
 */
const returnPage = (done: boolean) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${done ? "All set" : "Cancelled"}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#1e1e1e;color:#eee;text-align:center}p{color:#aaa}</style></head>
<body><div><h1>${done ? "All set" : "Nothing was charged"}</h1><p>You can close this tab and go back.</p></div><script>window.close()</script></body></html>`;

export function registerBillingRoutes(app: Hono<Env>, deps: { init: () => Promise<{ pool: Pool } | null>; down: (c: Context) => Response }) {
	app.get("/api/billing/return", c => {
		c.header("Cache-Control", "no-store");
		return c.html(returnPage(c.req.query("status") !== "cancel"));
	});

	app.post("/api/me/billing/checkout", async c => {
		const s = stripe();
		if (!s || !billingEnabled()) return c.json({ error: "Payments aren't set up on this server" }, 503);
		const body = z.object({ plan: z.enum(["monthly", "annual"]) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "Invalid request" }, 400);
		const origin = ownOrigin(c.req.raw.headers);
		if (!origin) return c.json({ error: "Open Fracital on one of its own addresses to subscribe" }, 400);
		const pool = c.get("pool");
		const user = c.get("user");
		const [meta, billing] = await Promise.all([userMeta(pool, user), billingSummary(pool, user.id)]);
		if (billing.subscription) return c.json({ error: "You already have a subscription. Manage it instead.", manage: true }, 409);
		// Premium an admin gave has no end, so paying for it would buy nothing. Promo (time-limited) premium can upgrade.
		if (meta.adminPremium) return c.json({ error: "You already have Premium" }, 409);
		const plan = body.data.plan;
		const coupon = process.env.STRIPE_LAUNCH_COUPON;
		// The launch offer: annual, first-timers only. Applied here, never typed in, so it can't be passed around.
		const launch = plan === "annual" && !!coupon && !meta.hadPremium;
		const session = await stripeCall("checkout", async () =>
			s.checkout.sessions.create({
				mode: "subscription",
				customer: await ensureCustomer(pool, user),
				client_reference_id: user.id,
				line_items: [{ price: priceFor(plan)!, quantity: 1 }],
				...(launch ? { discounts: [{ coupon }] } : {}),
				subscription_data: { metadata: { user_id: user.id, plan } },
				success_url: `${origin}/api/billing/return?status=success`,
				cancel_url: `${origin}/api/billing/return?status=cancel`,
				integration_identifier: `fracital-premium-${letters(8)}`,
			} as Stripe.Checkout.SessionCreateParams),
		);
		if (!session) return c.json({ error: "Couldn't start checkout. Try again in a moment." }, 502);
		return c.json({ url: session.url });
	});

	app.post("/api/me/billing/portal", async c => {
		const s = stripe();
		if (!s) return c.json({ error: "Payments aren't set up on this server" }, 503);
		const origin = ownOrigin(c.req.raw.headers);
		if (!origin) return c.json({ error: "Open Fracital on one of its own addresses to manage your subscription" }, 400);
		const { rows } = await c.get("pool").query<{ customer_id: string }>("select customer_id from fracital_billing where user_id = $1", [c.get("user").id]);
		if (!rows[0]) return c.json({ error: "You don't have a subscription yet" }, 404);
		const config = process.env.STRIPE_PORTAL_CONFIG;
		const session = await stripeCall("portal", () => s.billingPortal.sessions.create({ customer: rows[0].customer_id, return_url: `${origin}/api/billing/return?status=success`, ...(config ? { configuration: config } : {}) }));
		if (!session) return c.json({ error: "Couldn't open subscription management. Try again in a moment." }, 502);
		return c.json({ url: session.url });
	});

	// After Checkout or the portal: read the subscription now instead of waiting for the webhook.
	app.post("/api/me/billing/sync", async c => {
		const pool = c.get("pool");
		const { rows } = await pool.query<{ customer_id: string }>("select customer_id from fracital_billing where user_id = $1", [c.get("user").id]);
		if (rows[0] && stripe()) await syncCustomer(pool, rows[0].customer_id);
		return c.json(await billingSummary(pool, c.get("user").id));
	});

	app.post("/api/billing/webhook", async c => {
		const s = stripe();
		const secret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!s || !secret) return c.json({ error: "Not configured" }, 503);
		const ctx = await deps.init();
		if (!ctx) return deps.down(c);
		// The signature covers the raw body, so it's read as text, never parsed first.
		const payload = await c.req.text();
		let event: Stripe.Event;
		try {
			event = s.webhooks.constructEvent(payload, c.req.header("stripe-signature") ?? "", secret);
		} catch {
			return c.json({ error: "Bad signature" }, 400);
		}
		try {
			await handleEvent(ctx.pool, event);
		} catch (err) {
			console.error(`Stripe webhook ${event.type} (${event.id}) failed:`, err instanceof Error ? err.message : err);
			return c.json({ error: "Failed; Stripe will retry" }, 500);
		}
		return c.json({ received: true });
	});
}
