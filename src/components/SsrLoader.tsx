import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { ArrowLeftIcon, ArrowRightIcon, ChevronLeftIcon, StarIcon } from "@heroicons/react/24/solid";

const block = "bg-(--secondary) inset-shadow-(--inset-shadow-secondary)";
const ghost = "bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]";
const icon = "size-6.5 text-(--text-quaternary)";

/** Spinning ring in the accent color; the track adapts to light and dark themes. */
export const Spinner = () => <div className="size-10 rounded-full border-4 border-[color-mix(in_srgb,var(--text-primary)_12%,transparent)] border-t-(--accent) animate-spin" aria-hidden="true" />;

/** Content-area fallback while a lazy view loads. */
export const SpinnerLoader = () => (
	<div className="flex size-full items-center justify-center bg-(--primary)">
		<Spinner />
	</div>
);

/**
 * First-paint shell: a skeleton of the app layout with the spinner on top. The server prerenders this into
 * #root, so it holds no text: anything here ships as plaintext in the HTML.
 */
export const SsrLoader = () => (
	<div className="relative flex size-full flex-col bg-(--primary)" data-server-shell="true">
		<div className="flex size-full flex-col animate-[pulse_1.6s_infinite]" aria-hidden="true">
			<div className="flex h-20 w-full items-center gap-2.5 p-3">
				<div className={`size-10.5 rounded-full ${block}`} />
				<div className="flex items-center gap-2">
					<ArrowPathIcon className={`${icon} stroke-[2.5]`} />
					<ArrowLeftIcon className={icon} />
					<ArrowRightIcon className={icon} />
					<StarIcon className="size-7 text-(--text-quaternary)" />
				</div>
				<div className={`h-12 w-68 rounded-xl ${block}`} />
			</div>
			<div className="flex size-full gap-2.5 p-3 pt-0 pr-0">
				<div className={`size-full rounded-xl ${block}`}>
					<div className="-mt-14 flex h-full flex-col items-center justify-center gap-4 p-4">
						<div className={`h-16 w-96 max-w-full rounded-2xl ${ghost}`} />
						<div className="flex items-center gap-4">
							<div className={`h-33 w-55 rounded-2xl ${ghost}`} />
							<div className={`h-33 w-55 rounded-2xl ${ghost}`} />
							<div className={`h-33 w-55 rounded-2xl ${ghost}`} />
						</div>
					</div>
				</div>
				<div className="flex flex-col gap-2.5">
					<div className={`flex h-max w-10 items-center justify-center rounded-xl p-1.5 py-2 ${block}`}>
						<ChevronLeftIcon className="size-6 text-(--text-quaternary)" />
					</div>
					<div className={`h-full w-13 rounded-l-xl ${block}`} />
					<div className={`h-40 w-13 rounded-l-xl ${block}`} />
				</div>
			</div>
		</div>
		<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
			<Spinner />
		</div>
	</div>
);
