import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Loader } from "./components/Loader";
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
	createRoot(el).render(<StrictMode>{app}</StrictMode>);
}

mount();
