import { UserCircleIcon, UserIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "../components/Input";

interface LoginProps {
	query: string;
}

export const Login = ({ query }: LoginProps) => {
	const [page, setPage] = useState(query === "login" ? "login" : query === "register" ? "register" : "login");
	const [step, setStep] = useState<number>(0);

	return (
		<div className="flex flex-col items-center justify-center size-full">
			<div className="flex items-center justify-center gap-2">
				<UserCircleIcon className="size-15 text-(--accent)" />
				<XMarkIcon className="size-6 stroke-current stroke-2" />
				<img src="https://terbiumon.top/tb.svg" alt="TB" className="size-15" />
			</div>
			<div className="flex flex-col items-center w-2/5">
				{page === "login" ? (
					<div className="flex flex-col items-center justify-between w-full p-2 gap-3">
						<Input title="Username" type="text" />
						{step === 1 && <Input title="Password" type="password" />}
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
									}
								}}
							>
								{step === 0 ? "Next" : "Login"}
							</button>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center justify-between w-full p-2 gap-3">
						<Input title="Username" type="text" />
						<Input title="Email" type="email" />
						<Input title="Password" type="password" />
						<button className="flex items-center justify-center w-full p-2 bg-(--accent) rounded-md opacity-70 hover:opacity-100 cursor-pointer duration-150">Register</button>
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
