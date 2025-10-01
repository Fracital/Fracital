import { useEffect, useState, useRef } from "react"

export interface MenuItem {
    title: string;
    onClick: () => void;
    icon: string | React.ReactNode | null;
}

interface MenuProps {
    items: MenuItem[];
    position: { x: number; y: number };
    onClose: () => void;
}

export const ContextMenu= ({ items, position, onClose }: MenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const itemsRef = useRef<HTMLDivElement>(null)
    const [adjustedPos, setAdjustedPos] = useState(position);

    useEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;

        const { innerWidth, innerHeight } = window;
        const { offsetWidth, offsetHeight } = menu;

        let x = position.x;
        let y = position.y;

        if (x + offsetWidth > innerWidth) {
            x = innerWidth - offsetWidth - 8;
        }
        if (y + offsetHeight > innerHeight) {
            y = innerHeight - offsetHeight - 8;
        }

        setAdjustedPos({ x, y });
    }, [position]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
            menuRef.current.classList.add("translate-y-2", "opacity-0", "duration-150")
            itemsRef.current?.classList.add("translate-y-4", "opacity-0")
            setTimeout(() => {
                menuRef.current?.classList.remove("duration-150")
                onClose();
            }, 150)
        }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    useEffect(() => {
        setTimeout(() => {
            if (menuRef.current) {
                menuRef.current.classList.add("duration-150")
                menuRef.current.classList.remove("translate-y-2", "opacity-0")
            }
            if (itemsRef.current) {
                itemsRef.current.classList.remove("translate-y-4", "opacity-0")
            }
        }, 100)
    }, [])

    return (
        <div ref={menuRef} className="fixed z-50 min-w-[180px] p-1.5 bg-(--secondary) inset-shadow-(--inset-shadow-primary) rounded-xl shadow-lg translate-y-2 opacity-0"
        style={{ top: adjustedPos.y, left: adjustedPos.x }}>
            <div ref={itemsRef} className="flex flex-col translate-y-4 opacity-0 duration-500">
                {items.map((item, i) => (
                    <div key={i} className="group flex items-center justify-between gap-5 leading-none pl-3 p-2.5 text-sm text-[#ffffffad] hover:text-[#ffffffdf] hover:bg-[#ffffff10] rounded-md cursor-pointer duration-150"
                    onClick={() => {
                        item.onClick();
                        onClose();
                    }}>
                        <div className="font-medium w-max">
                            {item.title}
                        </div>
                        <div className="[&>svg]:group-hover:scale-110 [&>svg]:duration-150">
                            {item.icon}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}