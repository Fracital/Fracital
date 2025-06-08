export interface detailProps {
    title: string
    url: string
    icon: string | React.ReactNode | null
    id: string
}

export const navigationEvent = (detail: detailProps) => {
    const event = new CustomEvent("proxy-navigate", { detail })
    window.dispatchEvent(event)
}