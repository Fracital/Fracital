import { ArrowPathIcon, StarIcon } from "@heroicons/react/24/outline";
import { ArrowLeftIcon, ArrowRightIcon, ArrowsPointingOutIcon, Bars3Icon, ChevronLeftIcon, ChevronRightIcon, Cog6ToothIcon, MagnifyingGlassIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import { type BootAccount, type BootLayout, readBootAccount, readBootLayout } from "../libs/bootCache";

const block = "bg-(--secondary) inset-shadow-(--inset-shadow-primary)";
const ghost = "bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]";
const outline = `${ghost} inset-shadow-(--inset-shadow-secondary)`;
const icon = "size-4.5 text-(--text-quaternary)";

/** Spinning ring in the accent color; the track adapts to light and dark themes. */
export const Spinner = () => <div className="size-10 rounded-full border-4 border-[color-mix(in_srgb,var(--text-primary)_12%,transparent)] border-t-(--accent) animate-spin" aria-hidden="true" />;

/** Content-area fallback while a lazy view loads. */
export const SpinnerLoader = () => (
	<div className="flex size-full items-center justify-center bg-(--primary)">
		<Spinner />
	</div>
);

/** A quick link card on the new tab page: its icon, name and address. */
const LinkCardSkeleton = () => (
	<div className={`flex h-30.5 flex-col items-center gap-2 rounded-2xl pt-4 ${outline}`}>
		<div className={`size-14 rounded-xl ${ghost}`} />
		<div className={`h-3 w-16 rounded-full ${ghost}`} />
		<div className={`h-2.5 w-20 rounded-full ${ghost}`} />
	</div>
);

/** The account's picture, or the signed-out icon. */
const Avatar = ({ account, className }: { account: BootAccount | null; className: string }) => (account?.avatar ? <img src={account.avatar} alt="" className={`${className} rounded-full object-cover opacity-70`} /> : <UserCircleIcon className={`${className} text-(--text-quaternary)`} />);

/** Big Screen's tab count button in the top bar. */
const TabCount = () => <div className="mx-1 h-5 w-6 shrink-0 rounded-md border-2 border-(--text-quaternary)" />;

/** The side panel, collapsed: its open button and the tab list (peeking in from the edge, or the compact rail). */
const SidePanel = ({ layout }: { layout: BootLayout | null }) => {
	const Chevron = layout?.tabsLeft ? ChevronRightIcon : ChevronLeftIcon;
	if (layout?.compact)
		return (
			<div className="flex w-10 shrink-0 flex-col gap-2.5">
				<div className={`flex h-10 items-center justify-center rounded-3xl ${block}`}>
					<Chevron className="size-6 text-(--text-quaternary)" />
				</div>
				<div className={`flex flex-1 flex-col items-center justify-between rounded-3xl p-1 ${block}`}>
					<div className={`size-8 rounded-full ${ghost}`} />
					<div className={`size-8 rounded-full ${ghost}`} />
				</div>
			</div>
		);
	return (
		<div className={`flex w-10 shrink-0 flex-col gap-2.5 ${layout?.tabsLeft ? "items-end" : ""}`}>
			<div className={`flex h-10 w-full items-center justify-center rounded-xl ${block}`}>
				<Chevron className="size-6 text-(--text-quaternary)" />
			</div>
			<div className={`flex w-50 flex-1 flex-col justify-between rounded-2xl p-2 ${block}`}>
				<div className={`h-11 rounded-xl ${ghost}`} />
				<div className={`h-10 rounded-xl ${ghost}`} />
			</div>
		</div>
	);
};

/**
 * First-paint shell: a skeleton of the app as it opens (top bar, new tab page, side panel), with the spinner on top.
 * The server prerenders this into #root, so it holds no text: anything here ships as plaintext in the HTML.
 *
 * It follows the real layout without JS: the top bar folds at the same widths as Shell's (its COMPACT_WIDTH and
 * TINY_WIDTH are the bar's row, the window less 32px: 1212px and 632px here), and the new tab page sizes itself
 * with the same container queries as Home. Rendered again in the browser while the app loads (main.tsx), it also
 * shows the user's own tab layout and account, from last time (bootCache); the server's copy can't know them.
 */
export const SsrLoader = () => {
	const layout = readBootLayout();
	const account = readBootAccount();
	return (
		<div className="relative flex size-full flex-col overflow-hidden bg-(--primary)" data-server-shell="true">
			<div className="flex size-full flex-col gap-2.5 p-3 animate-[pulse_1.6s_infinite]" aria-hidden="true">
				{/* Top bar */}
				<div className="flex h-14 shrink-0 items-center justify-between gap-2.5 p-1">
					<div className="flex min-w-0 flex-1 items-center gap-2.5">
						<div className="flex items-center gap-1">
							{/* The home button; on narrow screens it's in the menu. */}
							<div className={`mr-1 size-9 rounded-full ${block} max-[631px]:hidden`} />
							<div className={`flex items-center gap-0.5 rounded-full p-1.5 ${block}`}>
								<span className="p-2">
									<ArrowPathIcon className={`${icon} stroke-2`} />
								</span>
								<span className="p-2">
									<ArrowLeftIcon className={icon} />
								</span>
								<span className="p-2">
									<ArrowRightIcon className={icon} />
								</span>
								<span className="p-2 max-[631px]:hidden">
									<StarIcon className={`${icon} stroke-2`} />
								</span>
							</div>
						</div>
						<div className={`flex h-12 min-w-0 flex-1 items-center justify-end rounded-2xl px-3 xl:w-88 xl:flex-none ${block}`}>
							<MagnifyingGlassIcon className="size-5 text-(--text-quaternary)" />
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2.5">
						{/* Wide: the bar's own buttons, the engine, the bar's settings and the account. */}
						<div className="hidden items-center gap-2.5 min-[1212px]:flex">
							{layout?.tabView && <TabCount />}
							<Bars3Icon className="size-6 text-(--text-quaternary)" />
							<ArrowsPointingOutIcon className="size-6 text-(--text-quaternary)" />
							<Cog6ToothIcon className="size-6 text-(--text-quaternary)" />
							<div className={`h-9 w-50 rounded-full ${block}`} />
							<div className={`h-9 w-14.5 rounded-full ${block}`} />
							<Avatar account={account} className="size-8" />
						</div>
						{/* Narrower: the top bar toggle and the menu. */}
						<div className="flex items-center gap-2.5 min-[1212px]:hidden">
							{layout?.tabView && <TabCount />}
							<div className={`size-9 rounded-full ${block}`} />
							<div className={`flex h-9 w-16.5 items-center gap-1.5 rounded-full p-1 pl-2 ${block}`}>
								<Bars3Icon className="size-5 text-(--text-quaternary)" />
								<Avatar account={account} className="size-7" />
							</div>
						</div>
					</div>
				</div>

				<div className={`flex min-h-0 flex-1 gap-2.5 ${layout?.tabsLeft ? "flex-row-reverse" : ""}`}>
					{/* The side ad panel (wide windows). */}
					<div className={`hidden w-79 shrink-0 rounded-2xl lg:block ${block}`} />

					{/* The new tab page */}
					<div className={`@container min-w-0 flex-1 overflow-hidden rounded-2xl ${block}`}>
						<div className="flex flex-col items-center gap-4 p-2 py-8">
							<div className={`h-12 w-45.5 rounded-xl @lg:h-15 @lg:w-57 @2xl:h-18 @2xl:w-68 ${ghost}`} />
							<div className={`h-12 w-full max-w-3xl rounded-full ${outline}`} />
							<div className="grid w-full max-w-3xl grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
								<LinkCardSkeleton />
								<LinkCardSkeleton />
								<LinkCardSkeleton />
								<LinkCardSkeleton />
								<LinkCardSkeleton />
								<LinkCardSkeleton />
								<div className="h-30.5 rounded-2xl border-2 border-dashed border-(--text-quaternary) opacity-60" />
							</div>
						</div>
					</div>

					{/* Big Screen keeps the tabs in the tab view, not the side panel. */}
					{!layout?.tabView && <SidePanel layout={layout} />}
				</div>
			</div>
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<Spinner />
			</div>
		</div>
	);
};
