import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: "https://auth.terbiumon.top",
	fetchOptions: {
		credentials: "include",
	},
});

export const { signIn, signUp, signOut, useSession } = authClient;
