import { useState } from "react";
import { Link } from "react-router-dom";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { PlusIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import { useSettingsStore } from "../store";

export interface linkProps {
	title: string;
	icon: string;
	color: string;
	href: string;
}

interface HomeProps {
	className?: string;
}

const Home = ({ className }: HomeProps) => {
	const settings = useSettingsStore(state => state.settings);
	const [links] = useState<linkProps[]>(
		(() => {
			const stored = window.localStorage.getItem("quicklinks");
			try {
				return stored ? JSON.parse(stored) : quickLinks;
			} catch {
				return quickLinks;
			}
		})(),
	);

	return (
		<div className={"flex flex-col items-center justify-center size-full p-2" + " " + className}>
			<div className="flex flex-col h-full items-center justify-center gap-4 mt-35">
				<span className="text-7xl font-black text-center text-accent text-stroke">FRACITAL</span>
				<div className="grid grid-cols-3 gap-4 h-95 overflow-auto">{links.length > 0 && links.map((link, index) => <LinkCard key={index} title={link.title} icon={link.icon} color={link.color} href={link.href} edit={false} brightness={isColorBright(link.color)} />)}</div>
			</div>
			<div className="flex items-center w-full overflow-hidden">
				<Link
					target="_blank"
					to="/LICENSE"
					className={
						"flex items-center h-full p-2 rounded-md leading-none text-(--text-quaternary) font-bold text-lg duration-150" +
						" " +
						`
                    ${settings.brightness === "dark" ? "hover:bg-[#ffffff18] hover:text-(--text-secondary)" : "hover:bg-[#00000025] hover:text-(--text-secondary)"}
                `
					}
				>
					© Fracital 2025
				</Link>
				<div className="flex gap-1.5 p-1.5">
					<Link target="_blank" to="https://discord.gg/unblock" className="flex items-center gap-1.5 text-(--text-quaternary) hover:text-(--text-tertiary) font-bold text-lg">
						<FontAwesomeIcon icon={faDiscord} className="text-current duration-150" />
						<span className="text-current duration-150">Discord</span>
					</Link>
				</div>
			</div>
		</div>
	);
};

export default Home;
