import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { PlusIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import { useSettingsStore } from "../store";
import { HolyText } from "../components/common/HolyText";
import { HolyLink } from "../components/common/HolyLink";

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

	const getLinks = () => {
		const stored = window.localStorage.getItem("quicklinks");
		try {
			return stored ? JSON.parse(stored) : quickLinks;
		} catch {
			return quickLinks;
		}
	};

	const [links, setLinks] = useState<linkProps[]>(getLinks());

	useEffect(() => {
		const handleLinksUpdate = () => {
			setLinks(getLinks());
		};

		window.addEventListener("links-upd", handleLinksUpdate);
		window.addEventListener("storage", handleLinksUpdate);

		return () => {
			window.removeEventListener("links-upd", handleLinksUpdate);
			window.removeEventListener("storage", handleLinksUpdate);
		};
	}, []);

	return (
		<div className={"@container flex flex-col items-center size-full p-2 overflow-y-auto" + " " + className}>
			<div className="flex flex-1 flex-col w-full items-center justify-center gap-4 py-6">
				<span className="text-5xl @lg:text-6xl @2xl:text-7xl font-black text-center text-accent text-stroke">
					<HolyText text="FRACITAL" />
				</span>
				<div className="grid w-full max-w-3xl grid-cols-2 @lg:grid-cols-3 gap-3 @lg:gap-4">{links.length > 0 && links.map((link, index) => <LinkCard key={index} title={link.title} icon={link.icon} color={link.color} href={link.href} edit={false} brightness={isColorBright(link.color)} />)}</div>
			</div>
			<div className="flex shrink-0 flex-wrap items-center w-full overflow-hidden">
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
					<HolyText text="© Fracital 2026" />
				</Link>
				<div className="flex gap-1.5 p-1.5">
					<HolyLink href="https://discord.gg/fracital" target="_blank" className="flex items-center gap-1.5 text-(--text-quaternary) hover:text-(--text-tertiary) font-bold text-lg">
						<FontAwesomeIcon icon={faDiscord} className="text-current duration-150" />
						<span className="text-current duration-150">
							<HolyText text="Discord" />
						</span>
					</HolyLink>
				</div>
			</div>
		</div>
	);
};

export default Home;
