import { UserCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "../components/Input";
import { signIn, signUp, useSession } from "../libs/auth";

interface LoginProps {
	query: string;
}

export const Login = ({ query }: LoginProps) => {
	const [page, setPage] = useState(query === "login" ? "login" : query === "register" ? "register" : "login");
	const [step, setStep] = useState<number>(0);
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const { data: session } = useSession();

	const handleLogin = async () => {
		if (!username || !password) {
			setError("Please fill in all fields");
			return;
		}
		setLoading(true);
		setError("");
		try {
			await signIn.email({
				email: username,
				password: password,
			});
		} catch (err: any) {
			setError(err.message || "Login failed");
		} finally {
			setLoading(false);
		}
	};

	const handleRegister = async () => {
		if (!username || !email || !password) {
			setError("Please fill in all fields");
			return;
		}
		setLoading(true);
		setError("");
		try {
			await signUp.email({
				name: username,
				email: email,
				password: password,
			});
		} catch (err: any) {
			setError(err.message || "Registration failed");
		} finally {
			setLoading(false);
		}
	};

	if (session?.user) {
		return (
			<div className="flex flex-col items-center justify-center size-full gap-4">
				<UserCircleIcon className="size-20 text-(--accent)" />
				<h2 className="text-2xl font-bold">Welcome, {session.user.name}!</h2>
				<p className="text-sm opacity-70">{session.user.email}</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center size-full">
			<div className="flex items-center justify-center gap-2">
				<UserCircleIcon className="size-15 text-(--accent)" />
				<XMarkIcon className="size-6 stroke-current stroke-2" />
				<img src="https://terbiumon.top/tb.svg" alt="TB" className="size-15" />
			</div>
			<div className="flex flex-col items-center w-2/5">
				{error && (
					<div className="w-full p-2 mb-2 bg-red-500/20 border border-red-500/50 rounded-md text-sm text-red-300">
						{error}
					</div>
				)}
				{page === "login" ? (
					<div className="flex flex-col items-center justify-between w-full p-2 gap-3">
						<Input 
							title="Email" 
							type="email" 
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
						{step === 1 && (
							<Input 
								title="Password" 
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleLogin()}
							/>
						)}
						<div className="relative flex items-center gap-2 w-full">
							<button
								className={
									"flex items-center justify-center w-3/5 cursor-pointer duration-150" +
									" " +
									`
                                    ${step === 0 ? "absolute opacity-0 -translate-x-1 pointer-events-none" : "opacity-70 hover:opacity-100"}
                                `
								}
							>
								forgot password?
							</button>
							<button
								className={
									"flex items-center justify-center p-2 bg-(--accent) rounded-md opacity-70 hover:opacity-100 cursor-pointer duration-150" +
									" " +
									`
                                    ${step === 0 ? "w-full" : "w-4/5"}
                                `
								}
								onClick={() => {
									if (step === 0) {
										setStep(1);
									} else {
										handleLogin();
									}
								}}
								disabled={loading}
							>
								{loading ? "Loading..." : step === 0 ? "Next" : "Login"}
							</button>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center justify-between w-full p-2 gap-3">
						<Input 
							title="Username" 
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
						<Input
							title="Email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
						<Input
							title="Password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleRegister()}
						/>
						<button
							className="flex items-center justify-center w-full p-2 bg-(--accent) rounded-md opacity-70 hover:opacity-100 cursor-pointer duration-150"
							onClick={handleRegister}
							disabled={loading}
						>
							{loading ? "Loading..." : "Register"}
						</button>
					</div>
				)}
			</div>
			<div className="flex items-center justify-center gap-1">
				{page === "register" ? (
					<>
						<span className="text-sm opacity-70">Have an account?</span>
						<Link
							to={"/login"}
							className="flex flex-col leading-none text-sm font-medium py-2 opacity-85 hover:opacity-100 cursor-pointer duration-150"
							onClick={() => {
								setPage("login");
							}}
						>
							Login
						</Link>
					</>
				) : (
					<>
						<span className="text-sm opacity-70">Don't have an account?</span>
						<Link
							to={"/register"}
							className="flex flex-col leading-none text-sm font-medium py-2 opacity-85 hover:opacity-100 cursor-pointer duration-150"
							onClick={() => {
								setPage("register");
							}}
						>
							Register
						</Link>
					</>
				)}
			</div>
		</div>
	);
};
