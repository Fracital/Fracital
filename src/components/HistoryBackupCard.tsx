/**
 * The account page's "History backup" card: the opt-in switch (src/libs/historyBackup.ts), what's backed up, and
 * the caps by plan. Off by default; the copy here matches the Privacy Policy's "Browsing history" item.
 */
import { ClockIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { getMe } from "../libs/auth";
import { setHistoryBackupEnabled, useHistoryBackup } from "../libs/historyBackup";
import { useTabsStore } from "../store";
import { HolyDynamic, HolyRich } from "./common/HolyRich";
import { HolyText } from "./common/HolyText";
import { Switch } from "./common/Switch";

const openTab = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });

const when = (iso: string) => {
	const s = (Date.now() - new Date(iso).getTime()) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
};

export const HistoryBackupCard = () => {
	const backup = useHistoryBackup();
	const [premium, setPremium] = useState(false);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		void getMe().then(me => setPremium(!!me?.premium));
	}, []);

	const toggle = async (on: boolean) => {
		setBusy(true);
		try {
			await setHistoryBackupEnabled(on);
		} finally {
			setBusy(false);
		}
	};
	const on = backup.enabled === true;

	return (
		<section className="flex flex-col gap-3 p-4 rounded-2xl bg-(--tertiary)">
			<div className="flex items-center gap-2">
				<ClockIcon className="size-5 text-(--text-secondary)" />
				<HolyText as="h2" className="font-bold flex-1" text="History backup" />
				<Switch on={on} label="Back up browsing history to this account" disabled={busy || backup.enabled === null} onChange={o => void toggle(o)} />
			</div>
			<HolyText as="p" className="text-sm text-(--text-secondary)" text="Back up the sites you visit to your Fracital account and keep history the same on every device you sign in on. It's off until you turn it on; until then your history stays in this browser." />
			<HolyText as="p" className="text-xs text-(--text-tertiary)" text="We never sell your history and we don't read it: a backup is only read back by your own signed-in devices. Turning this off deletes the backup." />
			{on && (
				<p className="text-xs text-(--text-tertiary)">
					{backup.status === "syncing" && <HolyText text="Backing up…" />}
					{backup.status === "error" && <span className="text-red-400">{backup.error}</span>}
					{backup.status === "synced" && (
						<HolyRich>
							Backed up · <HolyDynamic>{backup.count.toLocaleString()}</HolyDynamic> visits{backup.updatedAt ? <HolyDynamic>{` · ${when(backup.updatedAt)}`}</HolyDynamic> : null}
						</HolyRich>
					)}
				</p>
			)}
			<div className="flex flex-col text-xs text-(--text-tertiary)">
				<HolyRich>
					Up to <HolyDynamic>{backup.cap.toLocaleString()}</HolyDynamic> visits.
				</HolyRich>
				{!premium && (
					<button type="button" className="self-start text-left text-(--accent) cursor-pointer hover:underline" onClick={() => openTab("about:subscriptions", "Premium")}>
						<HolyRich>
							Up to <HolyDynamic>{backup.premiumCap.toLocaleString()}</HolyDynamic> with Premium.
						</HolyRich>
					</button>
				)}
				{/* Absolute: on a decoy host a relative path would stay on the decoy, which doesn't serve it. */}
				<button type="button" className="self-start text-left cursor-pointer hover:underline" onClick={() => openTab("https://fracit.al/privacy#history", "Privacy Policy")}>
					<HolyText text="How history is handled in the Privacy Policy" />
				</button>
			</div>
		</section>
	);
};
