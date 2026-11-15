#!/usr/bin/env node
/**
 * Sets up Fracital Premium in a Stripe account and prints the .env lines the server needs
 * (src/server/billing.ts):
 *
 *   - the "Fracital Premium" product with a $5/month and a $60/year price (lookup keys
 *     fracital_premium_monthly / fracital_premium_annual),
 *   - the launch coupon: 50% off once, the first year of the annual plan (the server applies it,
 *     only for accounts that have never had premium),
 *   - a Customer Portal configuration (cancel at period end, switch monthly/annual, card, invoices),
 *   - with --webhook-url, the webhook endpoint and its signing secret.
 *
 * The key comes from the environment, never an argument (arguments end up in shell history), and is
 * never printed. Use a test-mode or sandbox key; a live key needs --live.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs --webhook-url https://fracit.al/api/billing/webhook
 *
 * Running it again finds what it made before instead of making duplicates. Prices can't be edited in
 * Stripe: to change one, archive it in the Dashboard and run this again with the new amount below.
 */
import Stripe from "stripe";

const MONTHLY = { lookup: "fracital_premium_monthly", amount: 500, interval: "month", nickname: "Monthly" };
const ANNUAL = { lookup: "fracital_premium_annual", amount: 6000, interval: "year", nickname: "Annual" };
const COUPON_ID = "LAUNCH50";
// Software as a service, personal use. Required by Managed Payments (Stripe as merchant of record, on by
// default for new accounts) and used by Stripe Tax; must be one of Managed Payments' eligible codes.
const TAX_CODE = "txcd_10103000";
const SITE = "https://fracit.al";
// What billing.ts acts on, and nothing else.
const EVENTS = [
	"checkout.session.completed",
	"checkout.session.async_payment_succeeded",
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"customer.subscription.paused",
	"customer.subscription.resumed",
	"invoice.paid",
	"invoice.payment_failed",
	"charge.refunded",
	"charge.dispute.created",
	"radar.early_fraud_warning.created",
];

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
	console.error("Set STRIPE_SECRET_KEY in the environment (a test-mode or sandbox key).");
	process.exit(1);
}
if (/^(sk|rk)_live_/.test(key) && !flag("--live")) {
	console.error("That's a live key. Run again with --live if you really mean to set up live mode.");
	process.exit(1);
}
const webhookUrl = option("--webhook-url");
if (webhookUrl && !/^https:\/\//.test(webhookUrl)) {
	console.error("--webhook-url must be an https:// URL Stripe can reach.");
	process.exit(1);
}

const stripe = new Stripe(key);
const mode = /_live_/.test(key) ? "LIVE" : "test";
console.log(`Setting up Fracital Premium in ${mode} mode…\n`);

// Product and prices, found by lookup key.
const found = await stripe.prices.list({ lookup_keys: [MONTHLY.lookup, ANNUAL.lookup], expand: ["data.product"], limit: 10 });
const priceByLookup = new Map(found.data.map(p => [p.lookup_key, p]));
let product = found.data.map(p => p.product).find(p => p && typeof p === "object" && !p.deleted);
if (!product) {
	const existing = await stripe.products.list({ limit: 100, active: true });
	product = existing.data.find(p => p.metadata?.app === "fracital-premium");
}
if (!product) {
	product = await stripe.products.create({ name: "Fracital Premium", description: "No ads anywhere in Fracital, and 200 MB of game save backups.", tax_code: TAX_CODE, metadata: { app: "fracital-premium" } });
	console.log(`created product ${product.id}`);
} else {
	const taxCode = typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id;
	if (taxCode !== TAX_CODE) {
		product = await stripe.products.update(product.id, { tax_code: TAX_CODE });
		console.log(`product ${product.id} (exists; tax code set to ${TAX_CODE})`);
	} else console.log(`product ${product.id} (exists)`);
}

const ensurePrice = async spec => {
	const existing = priceByLookup.get(spec.lookup);
	if (existing) {
		const note = existing.unit_amount !== spec.amount ? ` — NOTE: it's ${existing.unit_amount} cents, this script says ${spec.amount}` : "";
		console.log(`price ${spec.lookup}: ${existing.id} (exists)${note}`);
		return existing;
	}
	const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: spec.amount, recurring: { interval: spec.interval }, lookup_key: spec.lookup, nickname: spec.nickname });
	console.log(`created price ${spec.lookup}: ${price.id}`);
	return price;
};
const monthly = await ensurePrice(MONTHLY);
const annual = await ensurePrice(ANNUAL);

// The launch coupon: half off the first annual invoice only.
let coupon = await stripe.coupons.retrieve(COUPON_ID).catch(err => (err?.statusCode === 404 ? null : Promise.reject(err)));
if (!coupon) {
	coupon = await stripe.coupons.create({ id: COUPON_ID, percent_off: 50, duration: "once", name: "Launch offer: 50% off your first year", applies_to: { products: [product.id] } });
	console.log(`created coupon ${coupon.id}`);
} else console.log(`coupon ${coupon.id} (exists)`);

// Customer Portal: what subscribers can do from "Manage subscription".
const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
let portal = configs.data.find(cfg => cfg.metadata?.app === "fracital-premium");
const portalFeatures = {
	invoice_history: { enabled: true },
	payment_method_update: { enabled: true },
	customer_update: { enabled: true, allowed_updates: ["email", "address"] },
	subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "missing_features", "other"] } },
	subscription_update: { enabled: true, default_allowed_updates: ["price"], products: [{ product: product.id, prices: [monthly.id, annual.id] }], proration_behavior: "create_prorations" },
};
if (!portal) {
	portal = await stripe.billingPortal.configurations.create({
		business_profile: { headline: "Manage your Fracital Premium", privacy_policy_url: `${SITE}/privacy`, terms_of_service_url: `${SITE}/tos` },
		features: portalFeatures,
		metadata: { app: "fracital-premium" },
	});
	console.log(`created portal configuration ${portal.id}`);
} else console.log(`portal configuration ${portal.id} (exists)`);

// Webhook endpoint. Stripe only shows a signing secret when the endpoint is created.
let webhookSecret = null;
if (webhookUrl) {
	const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
	const existing = endpoints.data.find(e => e.url === webhookUrl);
	if (existing) {
		console.log(`webhook ${existing.id} for ${webhookUrl} (exists; its signing secret is in the Dashboard under Developers → Webhooks)`);
		const missing = EVENTS.filter(e => !existing.enabled_events.includes(e) && !existing.enabled_events.includes("*"));
		if (missing.length) {
			await stripe.webhookEndpoints.update(existing.id, { enabled_events: [...new Set([...existing.enabled_events, ...missing])] });
			console.log(`  added events: ${missing.join(", ")}`);
		}
	} else {
		const endpoint = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: EVENTS, description: "Fracital Premium (src/server/billing.ts)", api_version: stripe.getApiField("version") });
		webhookSecret = endpoint.secret;
		console.log(`created webhook ${endpoint.id} for ${webhookUrl}`);
	}
}

console.log(`
Put these in the server's .env (with STRIPE_SECRET_KEY, ideally a restricted key — see below):

STRIPE_PRICE_MONTHLY=${monthly.id}
STRIPE_PRICE_ANNUAL=${annual.id}
STRIPE_LAUNCH_COUPON=${coupon.id}
STRIPE_PORTAL_CONFIG=${portal.id}${webhookSecret ? `\nSTRIPE_WEBHOOK_SECRET=${webhookSecret}` : webhookUrl ? "\nSTRIPE_WEBHOOK_SECRET=<from the Dashboard>" : "\nSTRIPE_WEBHOOK_SECRET=<run again with --webhook-url, or use the Stripe CLI's for local testing>"}

The server's key only needs: Customers (write), Checkout Sessions (write), Subscriptions (write),
Customer portal (write) and Charges (read). Create a restricted key (rk_…) with those for
STRIPE_SECRET_KEY rather than giving the server the full secret key.`);
