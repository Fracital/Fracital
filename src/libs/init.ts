declare global {
    interface Window {
        Filer: Filer
    }
}

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

export const init = () => {
    if (typeof window === "undefined" || !window.localStorage) throw Error("Cannot reach LocalStorage")

    console.log("%cFracital%c: %cinit%c()", "color: #fb74fe", "color: #ff7b72", "color: #c7a1f2", "color: #79c0ff");
    if (!window.localStorage.getItem("quicklinks")) {
        console.log("%cinit%c()%c -> setting: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
        window.localStorage.setItem("quicklinks", JSON.stringify(quickLinks));
    } else {
        console.log("%cinit%c()%c -> already set: %c[%cquicklinks%c]", "color: #c7a1f2", "color: #79c0ff", "color: #ffffffbf", "color: #56d364", "color: #e2b340", "color: #56d364");
    }
}