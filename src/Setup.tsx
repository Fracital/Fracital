import { useState, useEffect } from "react"
import type { SetStateAction, Dispatch } from "react"
import "./assets/default.css"
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";
import { useSetupStore } from "./store";
import { fileExists, dirExists } from "./types";

const Steps = () => {
    const step = useSetupStore(state => state.step);
    const setStep = useSetupStore(state => state.setStep);
    const [showFsLines, setShowFsLines] = useState<null | boolean>(null);
    const [userSettings, setUserSettings] = useState({ username: "", theme: "default" });
    const [formComplete, setFormComplete] = useState(false);
    const [typingDone, setTypingDone] = useState(false);
    const [themeOptions, setThemeOptions] = useState<string[]>(["default"]);

    // Sections: each with a title and lines
    const fsSections = [
        {
            title: "Filesystem Build",
            lines: [
                "Building filesystem...",
                "Creating /settings.json...",
                "Creating /themes directory...",
                "Creating /themes/default...",
                "Setup complete!"
            ]
        },
        {
            title: "User Settings",
            lines: [
                "Please configure your preferences."
            ]
        }
    ];

    useEffect(() => {
        const checkConfig = async () => {
            const settings = await fileExists("/settings.json");
            const themes = await dirExists("/themes");
            setShowFsLines(!(settings && themes));
        };
        checkConfig();
    }, []);

    useEffect(() => {
        if (!showFsLines) return;
        const fetchThemes = async () => {
            try {
                // Use Node.js require.context or dynamic import is not available in browser, so use static import for Vite/CRA
                // But for Node, you can use fs, but here we simulate with a static list
                // In a real Node context, use fs.readdirSync(path).filter(f => f.endsWith('.css'))
                const themeFiles = [
                    "default.css",
                    "amber.css",
                    "default - light.css"
                ];
                setThemeOptions(themeFiles.map(f => f.replace(/\.css$/, "")));
            } catch {
                setThemeOptions(["default"]);
            }
        };
        fetchThemes();
    }, [showFsLines]);

    if (showFsLines === null) return <div className="p-4">Checking setup...</div>;

    const sections = fsSections;
    const maxStep = sections.length - 1;
    const currentIndex = Math.max(0, Math.min(step, maxStep));
    const section = sections[currentIndex];
    const isUserSettings = section.title === "User Settings";

    // Handler for form submission
    const handleUserSettingsSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormComplete(true);
    };

    return (
        <div className={`step flex flex-col items-start size-full ${step === currentIndex ? 'active' : ''}`}>
            <div className="flex flex-col justify-center items-center size-full">
                <div className="flex flex-col w-full max-w-2xl bg-[#ffffff10] rounded-2xl shadow-[0_0_15px_2px_#00000030,_inset__0_0_0_2px_#ffffff3e]">
                    <TypingAnimation key={currentIndex + String(showFsLines)} lines={section.lines} onComplete={() => setTypingDone(true)} />
                    {isUserSettings && typingDone && (
                        <form className="flex flex-col gap-4 p-4" onSubmit={handleUserSettingsSubmit}>
                            <label className="flex flex-col gap-1">
                                Username
                                <input
                                    className="p-2 rounded bg-[#222] text-white"
                                    type="text"
                                    value={userSettings.username}
                                    onChange={e => setUserSettings(s => ({ ...s, username: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                Theme
                                <select
                                    className="p-2 rounded bg-[#222] text-white"
                                    value={userSettings.theme}
                                    onChange={e => setUserSettings(s => ({ ...s, theme: e.target.value }))}
                                >
                                    {themeOptions.map(theme => (
                                        <option key={theme} value={theme}>{theme.charAt(0).toUpperCase() + theme.slice(1)}</option>
                                    ))}
                                </select>
                            </label>
                            <button
                                className="p-2 bg-green-600 text-white rounded disabled:opacity-50"
                                type="submit"
                                disabled={!userSettings.username}
                            >
                                Save Settings
                            </button>
                        </form>
                    )}
                    <div className="flex w-full p-4 justify-between items-center bg-[#00000028]">
                        <div className="flex items-center gap-0.5">
                            <span className="text-lg font-bold px-2.5 p-1.5 bg-[#ffffff18] inset-shadow-[0_0_0_1px_#ffffff30] rounded-lg leading-none">{currentIndex + 1}</span>
                            <span className="pl-2 font-bold text-xl text-text-tertiary">{section.title}</span>
                        </div>
                        <div className="flex gap-2">
                            <button className="flex justify-center items-center p-2 bg-primary hover:bg-quaternary text-text-secondary hover:text-text-primary rounded-lg cursor-pointer" onMouseDown={() => {
                                if (currentIndex > 0) setStep(currentIndex - 1);
                            }} disabled={currentIndex === 0}>
                                <ChevronLeftIcon className="size-6 stroke-2 stroke-current duration-100" />
                            </button>
                            <button className="flex justify-center items-center p-2 bg-primary hover:bg-accent text-text-secondary hover:text-text-primary rounded-lg duration-100 cursor-pointer"
                            onMouseDown={() => {
                                if (currentIndex < maxStep && (!isUserSettings || formComplete)) setStep(currentIndex + 1);
                            }} disabled={currentIndex === maxStep || (isUserSettings && !formComplete)}>
                                <ChevronRightIcon className="size-6 stroke-2 stroke-current duration-150" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

const TypingAnimation = ({ lines, onComplete }: { lines: string[], onComplete?: () => void }) => {
    const [displayedLines, setDisplayedLines] = useState<string[]>([]);
    const [currentLine, setCurrentLine] = useState(0);
    const [currentText, setCurrentText] = useState("");
    const [charIndex, setCharIndex] = useState(0);

    useEffect(() => {
        if (currentLine < lines.length) {
            if (charIndex < lines[currentLine].length) {
                const timeout = setTimeout(() => {
                    setCurrentText(prev => prev + lines[currentLine][charIndex]);
                    setCharIndex(charIndex + 1);
                }, 30);
                return () => clearTimeout(timeout);
            } else {
                const timeout = setTimeout(() => {
                    setDisplayedLines(prev => [...prev, lines[currentLine]]);
                    setCurrentLine(currentLine + 1);
                    setCurrentText("");
                    setCharIndex(0);
                }, 400);
                return () => clearTimeout(timeout);
            }
        } else if (onComplete) {
            onComplete();
        }
    }, [charIndex, currentLine, lines, onComplete]);

    return (
        <pre className="flex flex-col w-full p-4 gap-1 font-mono font-medium text-lg leading-none">
            {displayedLines.map((line, i) => <div key={i}>{line}</div>)}
            {currentLine < lines.length && (
                <div>
                    {currentText}
                    <span
                        className="caret-block"
                        style={{
                            display: 'inline-block',
                            width: '0.5em',
                            height: '1em',
                            background: '#b5b5b5',
                            marginLeft: '2px',
                            verticalAlign: 'bottom',
                            animation: 'blink-caret 1s steps(1) infinite'
                        }}
                    />
                </div>
            )}
            <style>{`
                @keyframes blink-caret {
                    0%, 60% { opacity: 1; }
                    61%, 100% { opacity: 0; }
                }
            `}</style>
        </pre>
    );
};

export const Setup = () => {
    return (
        <div className="flex flex-col items-center justify-center size-full p-4 bg-[#1a1a1a]">
            <div className="size-full flex flex-col items-center justify-center gap-4 text-[#b5b5b5]">
                <Steps />
            </div>
        </div>
    )
}