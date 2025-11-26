import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: "https://auth.terbiumon.top",
	fetchOptions: {
		credentials: "include",
		customFetchImpl: (input, init) => {
			return window.fr.net.fetch(input, init);
		},
	},
});

export const { signIn, signUp, signOut, useSession } = authClient;
