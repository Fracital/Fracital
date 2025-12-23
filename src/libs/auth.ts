import { createAuthClient } from "better-auth/client";

export const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
	const savedCookies = localStorage.getItem("libcurl_cookies") || "";
	const session = new window.fr.net.HTTPSession({
		enable_cookies: true,
		cookie_jar: savedCookies,
	});
	session.import_cookies();
	try {
		const headers = new Headers(init?.headers);
		if (!headers.has("origin") && !headers.has("referer")) {
			headers.set("origin", window.location.origin);
		}
		const response = await session.fetch(input.toString(), {
			...init,
			headers,
		});
		return response;
	} finally {
		setTimeout(() => {
			const currentCookies = session.export_cookies();
			localStorage.setItem("libcurl_cookies", currentCookies);
			session.close();
			console.log("HTTP Session Destroyed");
		}, 100);
	}
};

export const authClient = createAuthClient({
	baseURL: "https://auth.terbiumon.top",
	fetchOptions: {
		credentials: "include",
		customFetchImpl: fetcher,
	},
});

export const { signIn, signUp, signOut } = authClient;
