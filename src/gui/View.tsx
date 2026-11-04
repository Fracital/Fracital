import { useEffect, useRef } from "react";
import type { TabProps } from "../components/Tab";
import { useTabsStore } from "../store";
import { aboutPages, getPageFromUrl, getQueryFromUrl } from "../libs/aboutPages";

interface ViewProps {
	children: React.ReactNode;
	id?: string;
}

export const View = ({ children, id }: ViewProps) => {
	const tabs = useTabsStore(state => state.tabs);
	const currentTab = tabs.find(tab => tab.current === true);
	const updateTab = useTabsStore(state => state.updateTab);
	const lastUrlRef = useRef<string>("");

	useEffect(() => {
		if (!id) return;
		const tab = tabs.find(t => t.id === id);
		if (!tab || !tab.url.includes("about:")) return;

		if (lastUrlRef.current === tab.url) return;
		lastUrlRef.current = tab.url;

		const pageName = getPageFromUrl(tab.url);
		if (!pageName || !aboutPages[pageName]) return;

		const pageConfig = aboutPages[pageName];
		const title = pageConfig.titleFor?.(getQueryFromUrl(tab.url)) ?? pageConfig.title ?? pageName;

		if (tab.title !== title || !tab.icon) {
			updateTab(id, {
				title,
				icon: pageConfig.icon,
			});
		}
	}, [id, tabs]);

	return (
		<div
			className={
				"absolute inset-0 duration-150" +
				" " +
				`
            ${currentTab ? (currentTab.id !== id ? "opacity-0 translate-y-2 pointer-events-none inset-shadow-(--inset-shadow-primary)" : "") : ""}
        `
			}
		>
			{children}
		</div>
	);
};
