import { useEffect, useState, type ReactNode } from "react";

/**
 * Cloaked front page: Fracital starts behind an ordinary-looking study guide (tab title
 * and icon included). Ctrl+E (⌘E on Mac) opens the real UI; pressing it again inside the
 * app flips back to the cover instantly — the app stays mounted underneath, music pauses.
 * Unlocking lasts for the tab's session, so a refresh doesn't re-cloak.
 */

const SESSION_KEY = "fracital:unlocked";
const COVER_TITLE = "Unit 4: Linear Equations — Study Guide";
const COVER_ICON = "/cover-icon.svg";

function applyChrome(cloaked: boolean) {
	document.title = cloaked ? COVER_TITLE : "Fracital";
	let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!icon) {
		icon = document.createElement("link");
		icon.rel = "icon";
		document.head.appendChild(icon);
	}
	icon.type = "image/svg+xml";
	icon.href = cloaked ? COVER_ICON : "/fracital.svg";
	document.documentElement.style.background = cloaked ? "#f8f9fa" : "#1a1a1a";
}

export const CloakGate = ({ children }: { children: ReactNode }) => {
	const startUnlocked = sessionStorage.getItem(SESSION_KEY) === "1";
	const [cloaked, setCloaked] = useState(!startUnlocked);
	// The app only loads after the first unlock; afterwards it stays mounted while cloaked.
	const [mounted, setMounted] = useState(startUnlocked);

	useEffect(() => applyChrome(cloaked), [cloaked]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "e") return;
			e.preventDefault();
			e.stopPropagation();
			setCloaked(prev => {
				const next = !prev;
				if (next) {
					sessionStorage.removeItem(SESSION_KEY);
					// Panic switch: silence anything playing.
					void import("../libs/playback").then(m => m.pause()).catch(() => {});
				} else {
					sessionStorage.setItem(SESSION_KEY, "1");
					setMounted(true);
				}
				return next;
			});
		};
		// Capture phase so the app's own shortcuts (and inputs) can't swallow it.
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

	return (
		<>
			{mounted && (
				<div className="h-full" style={cloaked ? { display: "none" } : undefined} aria-hidden={cloaked}>
					{children}
				</div>
			)}
			{cloaked && <CoverPage />}
		</>
	);
};

const problems: [string, string][] = [
	["3x + 7 = 22", "x = 5"],
	["2(x − 4) = 10", "x = 9"],
	["5x − 3 = 2x + 12", "x = 5"],
	["(x / 4) + 6 = 9", "x = 12"],
	["−3x + 8 = −7", "x = 5"],
	["4(2x + 1) = 3x + 19", "x = 3"],
];

/** A deliberately boring document page. No hints about what's behind it. */
const CoverPage = () => (
	<div className="fixed inset-0 z-[2147483647] overflow-auto bg-[#f8f9fa] text-[#202124]" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
		<header className="sticky top-0 flex items-center gap-3 px-4 h-14 bg-white border-b border-[#dadce0]">
			<img src={COVER_ICON} alt="" className="size-7" />
			<div className="flex flex-col leading-tight">
				<span className="text-[15px]">{COVER_TITLE}</span>
				<span className="text-[11px] text-[#5f6368]">Algebra I · Period 3 · Last edited Oct 28</span>
			</div>
			<div className="ml-auto flex items-center gap-2">
				<span className="hidden sm:inline text-xs text-[#5f6368]">View only</span>
				<div className="size-8 rounded-full bg-[#7e57c2] text-white text-sm flex items-center justify-center">S</div>
			</div>
		</header>
		<main className="flex justify-center py-8 px-4">
			<article className="w-full max-w-[816px] min-h-[1056px] bg-white shadow-[0_1px_3px_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)] px-10 sm:px-24 py-16 text-[15px] leading-7">
				<h1 className="text-[26px] mb-1">Unit 4: Solving Linear Equations</h1>
				<p className="text-[#5f6368] mb-6">Study guide for the unit test. Review the vocabulary, the steps, and work through the practice set before Friday.</p>

				<h2 className="text-[19px] mt-6 mb-2">Key vocabulary</h2>
				<ul className="list-disc pl-6 mb-4">
					<li>
						<b>Variable</b> — a letter that stands for an unknown number.
					</li>
					<li>
						<b>Coefficient</b> — the number multiplied by a variable (in 3x, the coefficient is 3).
					</li>
					<li>
						<b>Inverse operations</b> — operations that undo each other (addition/subtraction, multiplication/division).
					</li>
					<li>
						<b>Distributive property</b> — a(b + c) = ab + ac.
					</li>
				</ul>

				<h2 className="text-[19px] mt-6 mb-2">Steps for solving</h2>
				<ol className="list-decimal pl-6 mb-4">
					<li>Simplify each side: distribute and combine like terms.</li>
					<li>Move variable terms to one side using inverse operations.</li>
					<li>Move constant terms to the other side.</li>
					<li>Divide by the coefficient to isolate the variable.</li>
					<li>Check your answer by substituting it back into the original equation.</li>
				</ol>

				<h2 className="text-[19px] mt-6 mb-2">Worked example</h2>
				<p className="mb-2">Solve 2(x + 3) = 4x − 8.</p>
				<div className="pl-6 mb-4 font-mono text-[14px] leading-7">
					<div>2x + 6 = 4x − 8</div>
					<div>6 = 2x − 8</div>
					<div>14 = 2x</div>
					<div>x = 7</div>
				</div>
				<p className="mb-4">Check: 2(7 + 3) = 20 and 4(7) − 8 = 20 ✓</p>

				<h2 className="text-[19px] mt-6 mb-2">Practice set</h2>
				<table className="w-full border-collapse mb-6 text-[14px]">
					<thead>
						<tr className="bg-[#f1f3f4]">
							<th className="border border-[#dadce0] px-3 py-1.5 text-left font-normal w-12">#</th>
							<th className="border border-[#dadce0] px-3 py-1.5 text-left font-normal">Equation</th>
							<th className="border border-[#dadce0] px-3 py-1.5 text-left font-normal">Answer</th>
						</tr>
					</thead>
					<tbody>
						{problems.map(([eq, ans], i) => (
							<tr key={eq}>
								<td className="border border-[#dadce0] px-3 py-1.5">{i + 1}</td>
								<td className="border border-[#dadce0] px-3 py-1.5 font-mono">{eq}</td>
								<td className="border border-[#dadce0] px-3 py-1.5 font-mono">{ans}</td>
							</tr>
						))}
					</tbody>
				</table>

				<h2 className="text-[19px] mt-6 mb-2">Common mistakes</h2>
				<ul className="list-disc pl-6">
					<li>Forgetting to distribute to every term inside the parentheses.</li>
					<li>Changing the sign of only one side when moving a term.</li>
					<li>Dividing only part of one side by the coefficient.</li>
				</ul>
			</article>
		</main>
	</div>
);
