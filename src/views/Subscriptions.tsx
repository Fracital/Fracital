import { CheckBadgeIcon, CheckIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { HolyDynamic, HolyRich } from "../components/common/HolyRich";
import { HolyText } from "../components/common/HolyText";
import { getMe, type Me } from "../libs/auth";
import { openBillingPortal, type Plan, startCheckout } from "../libs/billing";
import { useSettingsStore, useTabsStore } from "../store";

interface Tier {
	id: string;
	name: string;
	/** "$3", left out while a tier has no set price. */
	price?: string;
	/** "/month" etc., shown after the price. */
	period?: string;
	tagline: string;
	features: string[];
	/** The tier the page points people to. */
	highlight?: boolean;
	/** A short label on the card ("Best value"). */
	badge?: string;
	/** Free: what everyone has, so no button to get it. */
	free?: boolean;
	/** The Stripe price it checks out (billing.ts). */
	plan?: Plan;
	/** The launch offer, shown instead to accounts that have never had premium (and to visitors not signed in). */
	launch?: Pick<Tier, "badge" | "tagline" | "features"> & { price: string };
}

/** The plans, in order. What each one includes is only written here. */
const TIERS: Tier[] = [
	{
		id: "free",
		name: "Free",
		price: "$0",
		tagline: "Everything in Fracital, paid for by ads.",
		features: ["Browse the web through Fracital", "Games, music, chat and the rest of the app", "75 MB of game save backups", "Your profile, streaks and history"],
		free: true,
	},
	{
		id: "premium",
		name: "Premium",
		plan: "monthly",
		price: "$5",
		period: "/month",
		tagline: "Fracital without the ads, and more room for your saves.",
		features: ["Everything in Free", "No banner, side or video ads", "No ad breaks in music", "200 MB of game save backups", "A premium badge on your account"],
	},
	{
		id: "premium-annual",
		name: "Premium Annual",
		plan: "annual",
		price: "$60",
		period: "/year",
		tagline: "All of Premium, paid once a year.",
		features: ["Everything in Premium", "Pay once a year"],
		highlight: true,
		launch: {
			price: "$30",
			badge: "50%",
			tagline: "Launch offer: a whole year of Premium for half price.",
			features: ["Everything in Premium", "Pay once a year", "50% off your first year, for accounts that haven't had Premium before"],
		},
	},
];

/** about:subscriptions (also about:premium): the plans, what each includes and which one you have. */
const Subscriptions = ({ className = "" }: { className?: string }) => {
	const dark = useSettingsStore(s => s.settings.brightness !== "light");
	const newTab = useTabsStore(s => s.newTab);
	// undefined while loading, null when signed out.
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	useEffect(() => {
		const load = () => void getMe().then(setMe);
		load();
		window.addEventListener("account-upd", load);
		return () => window.removeEventListener("account-upd", load);
	}, []);

	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const run = (id: string, fn: () => Promise<unknown>) => async () => {
		setBusy(id);
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(null);
		}
	};

	const premium = !!me?.premium;
	const sub = me?.billing?.subscription ?? null;
	// Premium that isn't paid for and doesn't end: nothing to buy.
	const giftedPremium = premium && !sub && !me?.premiumUntil;
	// New members only. Shown while the account loads and to visitors not signed in, who are new as far as we know.
	const launchOffer = !me || (!premium && !me.hadPremium);
	const blue = dark ? "#398fff" : "#9fc8ff";
	const openAccount = () => newTab({ id: createId(), title: "Fracital Account", url: "about:account", displayUrl: "about:account", icon: null, current: true });
	const accent = "flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-(--accent) text-white hover:brightness-110 cursor-pointer duration-150";
	const subtle = `flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold cursor-pointer duration-150 ${dark ? "bg-[#ffffff10] hover:bg-[#ffffff1c]" : "bg-[#00000010] hover:bg-[#0000001c]"}`;
	const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : null);
	const until = date(me?.premiumUntil);

	return (
		<div className={`flex flex-col items-center size-full overflow-auto p-6 ${className}`}>
			<div className="flex flex-col gap-6 w-full max-w-5xl">
				<header className="flex flex-col items-center gap-2 text-center pt-4">
					<CheckBadgeIcon className="size-12" style={{ color: blue }} />
					<HolyText as="h1" className="text-3xl font-bold" text="Fracital Premium" />
					<HolyText as="p" className="text-(--text-secondary) max-w-xl" text="Fracital is free for everyone. Premium takes the ads away and gives your game saves more room." />
				</header>

				<section className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-(--tertiary)">
					{premium ? <CheckBadgeIcon className="size-8 shrink-0" style={{ color: blue }} /> : <UserCircleIcon className="size-8 shrink-0 text-(--text-tertiary)" />}
					<div className="flex flex-col flex-1 min-w-48">
						{me === undefined ? (
							<HolyText className="text-(--text-tertiary)" text="Checking your plan…" />
						) : me === null ? (
							<>
								<HolyText className="font-semibold" text="Sign in to see your plan" />
								<HolyText className="text-sm text-(--text-tertiary)" text="Premium belongs to your Fracital Account, so it follows you to every device." />
							</>
						) : sub ? (
							<>
								<HolyText className="font-semibold" text={sub.plan === "annual" ? "You have Premium Annual" : "You have Premium"} />
								{sub.endsAt ? (
									<HolyRich className="text-sm text-(--text-tertiary)">
										Cancelled; Premium lasts until <HolyDynamic>{date(sub.endsAt)}</HolyDynamic>
									</HolyRich>
								) : sub.status === "past_due" ? (
									<HolyText className="text-sm text-amber-400" text="Your last payment didn't go through. Update your card to keep Premium." />
								) : (
									sub.renewsAt && (
										<HolyRich className="text-sm text-(--text-tertiary)">
											Renews <HolyDynamic>{date(sub.renewsAt)}</HolyDynamic>
										</HolyRich>
									)
								)}
							</>
						) : premium ? (
							<>
								<HolyText className="font-semibold" text="You have Premium" />
								{until ? (
									<HolyRich className="text-sm text-(--text-tertiary)">
										Until <HolyDynamic>{until}</HolyDynamic>
									</HolyRich>
								) : (
									<HolyText className="text-sm text-(--text-tertiary)" text="Thanks for supporting Fracital." />
								)}
							</>
						) : (
							<>
								<HolyText className="font-semibold" text="You're on Free" />
								<HolyText className="text-sm text-(--text-tertiary)" text="Everything works; ads keep it running." />
							</>
						)}
					</div>
					{me === null && (
						<button type="button" className={accent} onClick={openAccount}>
							<HolyText text="Sign in" />
						</button>
					)}
					{sub && (
						<button type="button" className={subtle} disabled={!!busy} onClick={run("portal", openBillingPortal)}>
							<HolyText text={busy === "portal" ? "Opening…" : "Manage subscription"} />
						</button>
					)}
				</section>

				{error && <p className="px-4 py-2 rounded-xl text-sm bg-red-500/15 text-red-300">{error}</p>}

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
					{TIERS.map(base => {
						// The launch price is struck through against the usual one; accounts that have had premium get the usual one.
						const tier = launchOffer && base.launch ? { ...base, ...base.launch, wasPrice: base.price } : { ...base, wasPrice: undefined };
						const missedLaunch = !launchOffer && !!base.launch && !premium;
						// Free when there's no premium; a paid card when it's the plan being paid for.
						const current = !!me && (tier.free ? !premium : !!sub && sub.plan === tier.plan);
						return (
							<article key={tier.id} className="flex flex-col gap-4 p-5 rounded-2xl bg-(--tertiary)" style={tier.highlight ? { boxShadow: `inset 0 0 0 2px ${blue}` } : undefined}>
								<div className="flex items-center justify-between gap-2">
									<HolyText as="h2" className="text-xl font-bold" text={tier.name} />
									{current ? <HolyText className="text-xs font-semibold px-2 py-1 rounded-md bg-[#8882]" text="Your plan" /> : tier.badge && <HolyText className="text-xs font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: blue, color: dark ? "#fff" : "#0b2a55" }} text={tier.badge} />}
								</div>
								{tier.price && (
									<div className="flex items-baseline gap-1">
										{tier.wasPrice && <span className="text-lg font-semibold line-through text-(--text-tertiary) mr-1">{tier.wasPrice}</span>}
										<span className="text-3xl font-bold">{tier.price}</span>
										{tier.period && <span className="text-sm text-(--text-tertiary)">{tier.period}</span>}
									</div>
								)}
								<HolyText as="p" className="text-sm text-(--text-secondary)" text={tier.tagline} />
								{missedLaunch && <HolyText as="p" className="text-xs text-(--text-tertiary)" text="The 50% launch offer is for accounts that haven't had Premium before." />}
								<ul className="flex flex-col gap-2 flex-1">
									{tier.features.map(feature => (
										<li key={feature} className="flex items-start gap-2 text-sm">
											<CheckIcon className="size-4 shrink-0 mt-0.5" style={{ color: tier.highlight ? blue : undefined }} />
											<HolyText text={feature} />
										</li>
									))}
								</ul>
								{!tier.free && me === null && (
									<button type="button" className={tier.highlight ? accent : subtle} onClick={openAccount}>
										<HolyText text="Sign in to subscribe" />
									</button>
								)}
								{/* Subscribers switch or cancel in the portal (Manage subscription above). */}
								{!tier.free && me && !sub && !giftedPremium && tier.plan && (
									<button type="button" className={tier.highlight ? accent : subtle} disabled={!!busy} onClick={run(tier.id, () => startCheckout(tier.plan!))}>
										{busy === tier.id ? (
											<HolyText text="Opening checkout…" />
										) : (
											<HolyRich>
												Get <HolyDynamic>{tier.name}</HolyDynamic>
											</HolyRich>
										)}
									</button>
								)}
							</article>
						);
					})}
				</div>

				<section className="flex flex-col gap-2 p-4 rounded-2xl bg-(--tertiary) text-sm">
					<HolyText as="h2" className="font-bold" text="How does paying work?" />
					<HolyText as="p" className="text-(--text-secondary)" text="Payments go through Stripe; we never see your card. Cancel any time under Manage subscription and you keep Premium until the end of what you've paid for. You can also win time-limited Premium by keeping a streak while a promo is running." />
				</section>
			</div>
		</div>
	);
};

export default Subscriptions;
