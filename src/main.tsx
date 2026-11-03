import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Loader } from "./components/Loader";
import "./index.css";

const AppShell = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<Suspense fallback={<Loader type="skeleton" />}>
				<AppShell />
			</Suspense>
		</BrowserRouter>
	</StrictMode>,
);
