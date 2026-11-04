import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Loader } from "./components/Loader";
import { CloakGate } from "./components/CloakGate";
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
			<Suspense fallback={<Loader type="skeleton" />}>
				<AppShell />
			</Suspense>
		</BrowserRouter>
	);
	// Decoy hosts already uncloaked via Ctrl+E; the study-guide cover is only for direct hosts.
	createRoot(el).render(<StrictMode>{shadowRoot ? app : <CloakGate>{app}</CloakGate>}</StrictMode>);
}

mount();
