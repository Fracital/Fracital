/**
 * about:blog, and about:blog?<slug> for one post: the dev log and the Terms / Privacy Policy update posts
 * (src/server/blog.ts). The list and the posts come from the public API; a post's HTML is sanitized before it's
 * shown, and links inside it open in a new tab rather than leaving the app.
 */
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon, NewspaperIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useMemo, useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { updatePageTab } from "../libs/aboutPages";
import { type BlogPost, type BlogPostMeta, blog, KIND_LABELS, type PostKind, postDate, postUrl, sanitizeHtml } from "../libs/blog";
import { useSettingsStore, useTabsStore } from "../store";

const BADGE: Record<PostKind, string> = { devlog: "bg-[#199e70]/20 text-[#4fc89a]", terms: "bg-[#d95926]/20 text-[#f0865a]", privacy: "bg-[#3987e5]/20 text-[#7eb3f5]" };

const Badge = ({ kind }: { kind: PostKind }) => <HolyText className={`rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[kind]}`} text={KIND_LABELS[kind]} />;

const openUrl = (url: string, title: string) => useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title, icon: null, current: true });

const Blog = ({ query, className = "" }: { query?: string; className?: string }) => {
	const dark = useSettingsStore(s => s.settings.brightness) !== "light";
	const tabId = useTabsStore(s => s.tabs.find(t => t.current)?.id);
	const slug = (query || "").split("&")[0] || null;
	const [posts, setPosts] = useState<BlogPostMeta[] | null>(null);
	const [post, setPost] = useState<BlogPost | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		blog.list().then(setPosts, e => setError((e as Error).message));
	}, []);
	useEffect(() => {
		if (!slug) {
			setPost(null);
			return;
		}
		let stale = false;
		blog.get(slug).then(
			p => !stale && setPost(p),
			e => !stale && setError((e as Error).message),
		);
		return () => {
			stale = true;
		};
	}, [slug]);

	const html = useMemo(() => (post ? sanitizeHtml(post.html) : ""), [post]);
	const show = (p: BlogPostMeta) => tabId && updatePageTab(tabId, "blog", { title: p.title, query: p.slug });
	const back = () => tabId && updatePageTab(tabId, "blog");

	// A link in a post: the public site's pages open in a new tab; another post opens here.
	const onContentClick = (e: React.MouseEvent) => {
		const a = (e.target as HTMLElement).closest("a");
		if (!a) return;
		e.preventDefault();
		const href = a.getAttribute("href") || "";
		const other = /^\/blog\/([a-z0-9-]+)$/.exec(href);
		if (other && tabId) return updatePageTab(tabId, "blog", { title: a.textContent || other[1], query: other[1] });
		openUrl(/^https?:\/\//i.test(href) || href.startsWith("mailto:") ? href : `https://fracit.al${href.startsWith("/") ? "" : "/"}${href}`, a.textContent || href);
	};

	const card = `rounded-2xl p-4 ${dark ? "bg-[#ffffff08]" : "bg-[#00000008]"}`;

	return (
		<div className={`size-full overflow-y-auto p-4 sm:p-6 ${className}`}>
			<div className="mx-auto flex max-w-3xl flex-col gap-4">
				{slug && post ? (
					<article className="flex flex-col gap-4">
						<button type="button" className="flex items-center gap-1.5 self-start text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={back}>
							<ArrowLeftIcon className="size-4" />
							<HolyText text="All posts" />
						</button>
						<div className="flex flex-col gap-2">
							{/* The post's title and date: data values. */}
							<h1 className="text-3xl font-bold leading-tight">{post.title}</h1>
							<div className="flex flex-wrap items-center gap-2 text-sm text-(--text-tertiary)">
								<Badge kind={post.kind} />
								<span>{postDate(post.date)}</span>
								<button type="button" className="ml-auto flex items-center gap-1 text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => openUrl(postUrl(post.slug), post.title)}>
									<HolyText text="Open on fracit.al" />
									<ArrowTopRightOnSquareIcon className="size-4" />
								</button>
							</div>
						</div>
						{/* The post itself, sanitized; written by the team, not by users. The click handler only redirects its links, which are keyboard-operable on their own. */}
						{/* biome-ignore lint/a11y/noStaticElementInteractions: delegating the anchors' clicks */}
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: the anchors handle Enter themselves */}
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify in sanitizeHtml */}
						<div className={`${card} blog-post`} onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
					</article>
				) : (
					<>
						<div className="flex flex-col gap-1">
							<HolyText as="h1" className="text-3xl font-bold" text="Blog" />
							<HolyText as="p" className="text-sm text-(--text-secondary)" text="Dev logs, and what changed in the Terms and the Privacy Policy." />
						</div>
						{error && <p className="text-sm text-red-400">{error}</p>}
						{!posts && !error && <HolyText className="text-sm text-(--text-tertiary)" text="Loading…" />}
						{posts?.length === 0 && <HolyText className="text-sm text-(--text-tertiary)" text="Nothing here yet." />}
						{slug && !post && !error && <HolyText className="text-sm text-(--text-tertiary)" text="Loading…" />}
						<ol className="flex flex-col gap-3">
							{posts?.map(p => (
								<li key={p.slug}>
									<button type="button" className={`${card} flex w-full flex-col gap-1.5 text-left cursor-pointer hover:bg-[#8881] duration-150`} onClick={() => show(p)}>
										<span className="flex flex-wrap items-center gap-2 text-xs text-(--text-tertiary)">
											<Badge kind={p.kind} />
											<span>{postDate(p.date)}</span>
										</span>
										<span className="text-lg font-bold leading-tight">{p.title}</span>
										{p.summary && <span className="text-sm text-(--text-secondary)">{p.summary}</span>}
									</button>
								</li>
							))}
						</ol>
					</>
				)}
				{!slug && !posts && !error && <NewspaperIcon className="mx-auto size-10 text-(--text-tertiary) opacity-40" />}
			</div>
		</div>
	);
};

export default Blog;
