import { useState } from "react";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";

export interface linkProps {
    title: string;
    icon: string;
    color: string;
    href: string;
}

interface HomeProps {
    className?: string
}

const Home = ({ className }: HomeProps) => {
    const [links] = useState<linkProps[]>(
        (() => {
            const stored = window.localStorage.getItem("quicklinks");
            try {
                return stored ? JSON.parse(stored) : quickLinks;
            } catch {
                return quickLinks;
            }
        })()
    );

    return (
        <div className={"flex flex-col items-center justify-center size-full p-2" + " " + className}>
            <div className="flex flex-col items-center justify-center gap-4">
                <span className="text-7xl font-black text-center text-accent text-stroke">FRACITAL</span>
                <div className="flex gap-4">
                    {
                        links.length > 0 && links.map((link, index) => (
                            <LinkCard
                                key={index}
                                title={link.title}
                                icon={link.icon}
                                color={link.color}
                                href={link.href}
                                brightness={isColorBright(link.color)}
                            />
                        ))
                    }
                </div>
            </div>
        </div>
    );
}

export default Home;