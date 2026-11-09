import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SsrLoader } from "./components/SsrLoader";
import { getCloakShadowRoot } from "./libs/cloak";
import "./index.css";

const AppShell = lazy(() => import("./App"));

function mount() {
	// Cloaked pages hand over a closed shadow root with its own #root; mount
	// there so the app renders above the decoy without touching its DOM.
	const shadowRoot = getCloakShadowRoot();
	const el = shadowRoot?.getElementById("root") || document.getElementById("root");
	if (!el) {
		requestAnimationFrame(mount);
		return;
	}
	const app = (
		<BrowserRouter>
			<Suspense fallback={<SsrLoader />}>
				<AppShell />
			</Suspense>
		</BrowserRouter>
	);
	// The server prerenders a static loader into #root so the first paint needs
	// no JS; createRoot replaces it on the first commit (no hydration to match).
	createRoot(el).render(<StrictMode>{app}</StrictMode>);
}

mount();
