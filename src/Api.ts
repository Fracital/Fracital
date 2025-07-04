import { useSettingsStore } from "./store"
import { type COM } from "./types"

declare const fr: COM
declare global {
    interface Window {
        fr: COM
    }
}

export const Api = async () => {
    const settings = useSettingsStore(state => state.settings)
    const getSettings = useSettingsStore(state => state.getSettings)
    const setSettings = useSettingsStore(state => state.setSettings)

    window.fr = {
        theme: {
            getTheme: () => {
                const theme = getSettings("theme")
                return theme
            },
            setTheme: async (name: string) => {
                if (getSettings("theme") === name) return false
                const themes = await window.Filer.fs.promises.readdir("/themes", "utf8")
                if (themes.find(theme => theme === name)) {
                    setSettings("theme", name)
                    return true
                } else return false
            }
        }
    }
}