/**
 * The home page's notice when the Privacy Policy or the Terms changed: the latest such blog post, while it's recent,
 * until dismissed. This is the "notice in Fracital" the policies promise for significant changes.
 */
import { ShieldCheckIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useState } from "react";
import { type BlogPostMeta, blog } from "../libs/blog";
import { useHolyAttr } from "../libs/holy-attr";
import { useTabsStore } from "../store";
import { HolyText } from "./common/HolyText";

const DISMISSED_KEY = "fracital:policy-notice-dismissed";
/** A change older than this is no longer news. */
const MAX_AGE_MS = 60 * 24 * 60 * 60_000;

const readDismissed = () => {
	try {
		return localStorage.getItem(DISMISSED_KEY);
	} catch {
		return null;
	}
};

export const PolicyNotice = ({ className = "" }: { className?: string }) => {
	const [post, setPost] = useState<BlogPostMeta | null>(null);
	const [dismissed, setDismissed] = useState(readDismissed);
	const { ref: closeRef, placeholder: closeAttrs } = useHolyAttr({ "aria-label": "Dismiss", title: "Dismiss" });

	useEffect(() => {
		blog.list({ kind: ["privacy", "terms"], limit: 1 }).then(
			posts => setPost(posts[0] ?? null),
			() => setPost(null),
		);
	}, []);

	if (!post || dismissed === post.slug || Date.now() - new Date(post.date).getTime() > MAX_AGE_MS) return null;

	const dismiss = () => {
		setDismissed(post.slug);
		try {
			localStorage.setItem(DISMISSED_KEY, post.slug);
		} catch {}
	};
	const read = () => useTabsStore.getState().newTab({ id: createId(), url: `about:blog?${post.slug}`, displayUrl: `about:blog?${post.slug}`, title: post.title, icon: null, current: true });

	return (
		<div role="status" className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] @xl:grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 bg-(--accent)/12 inset-shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--accent)_30%,transparent)] ${className}`}>
			<ShieldCheckIcon className="size-9 shrink-0 self-start @xl:self-center text-(--accent)" />
			<div className="flex min-w-0 flex-col gap-1">
				<HolyText className="font-bold leading-tight" text={post.kind === "privacy" ? "Privacy Policy updated" : "Terms of Service updated"} />
				{/* The post's own summary: a data value. */}
				<p className="text-sm text-(--text-secondary)">{post.summary || post.title}</p>
			</div>
			<button type="button" className="col-start-2 row-start-2 @xl:col-start-3 @xl:row-start-1 justify-self-start shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold bg-(--accent) text-white hover:brightness-110 cursor-pointer duration-150" onClick={read}>
				<HolyText text="Read more" />
			</button>
			<button ref={closeRef} {...closeAttrs} type="button" className="col-start-3 row-start-1 @xl:col-start-4 shrink-0 self-start rounded-full p-1 text-(--text-tertiary) hover:text-(--text-primary) hover:bg-[#8882] cursor-pointer duration-150" onClick={dismiss}>
				<XMarkIcon className="size-4" />
			</button>
		</div>
	);
};
