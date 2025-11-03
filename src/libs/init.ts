import { dirExists, fileExists } from "../types";

export const quickLinks = [
    {
        title: "Github",
        icon: "https://github.githubassets.com/favicons/favicon.svg",
        color: "#fff",
        href: "https://github.com/NovaAppsInc/Fracital"
    },
    {
        title: "Fracital",
        icon: "/fracital.svg",
        color: "#fb74fe",
        href: "https://fractial.dev"
    },
    {
        title: "Google",
        icon: "/google.svg",
        color: "#ffffff",
        href: "https://google.com"
    }
]

export const init = async () => {
    if (typeof window === "undefined" || !window.localStorage) throw Error("Cannot reach LocalStorage");

    if(!await fileExists("/settings.json")) {
        console.log("%cFracital%c: %cinit%c() -> %csettings.json%c does not exist, creating default settings", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
        await window.fr.fs.promises.writeFile("/settings.json", JSON.stringify({
            theme: "default",
            proxy: "uv",
            quicklinks: JSON.stringify(quickLinks),
            "floating-tabs": false
        }, null, 4));
    } else {
        console.log("%cFracital%c: %cinit%c() -> %csettings.json%c already exists", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
    }
    if (!await dirExists("/themes")) {
        const defaultTheme = await fetch("/themes/default.css").then(res => res.text());
        const amberTheme = await fetch("/themes/amber.css").then(res => res.text());
        const lightTheme = await fetch("/themes/light.css").then(res => res.text());
        const greyTheme = await fetch("/themes/greyscale.css").then(res => res.text());
        await window.fr.fs.promises.mkdir("/themes");
        await window.fr.fs.promises.mkdir("/themes/default");
        await window.fr.fs.promises.writeFile("/themes/default/index.json", JSON.stringify({
            name: "Default",
            description: "The default theme for Fracital.",
            author: "SNOOT",
            version: "1.0.0",
            license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
            color: "#fb74fe",
            brightness: "dark"
        }));
        await window.fr.fs.promises.writeFile("/themes/default/index.css", defaultTheme);
        await window.fr.fs.promises.mkdir("/themes/light");
        await window.fr.fs.promises.writeFile("/themes/light/index.json", JSON.stringify({
            name: "Light",
            description: "The default light theme for Fracital.",
            author: "SNOOT",
            version: "1.0.0",
            license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
            color: "#e4b174",
            brightness: "light"
        }));
        await window.fr.fs.promises.writeFile("/themes/light/index.css", lightTheme);
        await window.fr.fs.promises.mkdir("/themes/amber");
        await window.fr.fs.promises.writeFile("/themes/amber/index.json", JSON.stringify({
            name: "Amber",
            description: "A amber theme for Fracital.",
            author: "SNOOT",
            version: "1.0.0",
            license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
            color: "#e4b174",
            brightness: "light"
        }));
        await window.fr.fs.promises.writeFile("/themes/amber/index.css", amberTheme);
        await window.fr.fs.promises.mkdir("/themes/greyscale");
        await window.fr.fs.promises.writeFile("/themes/greyscale/index.json", JSON.stringify({
            name: "Greyscale",
            description: "A greyscale theme for Fracital.",
            author: "SNOOT",
            version: "1.0.0",
            license: "[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt)",
            color: "#e4b174",
            brightness: "dark"
        }));
        await window.fr.fs.promises.writeFile("/themes/greyscale/index.css", greyTheme);
        console.log("%cFracital%c: %cinit%c() -> %cdirectory%c /themes created with default themes", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff", "color: #56d364", "color: #e2b340");
        window.location.reload();
    }
    if (!await dirExists("/music")) {
        await window.fr.fs.promises.mkdir("/music");
    }

    console.log("%cFracital%c: %cinit%c()", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff");
    if (!window.localStorage.getItem("quicklinks")) {
        console.log("%cinit%c()%c -> setting: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
        window.localStorage.setItem("quicklinks", JSON.stringify(quickLinks));
    } else {
        console.log("%cinit%c()%c -> already set: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
    }
}