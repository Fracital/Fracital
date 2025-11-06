import { createContext, useContext, useState, type ReactNode } from "react";

type ModalContextType = {
    openModal: (content: ReactNode, data?: any) => void
    closeModal: () => void
    data: any
    isOpen: boolean
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider = ({ children }: { children: ReactNode }) => {
    const [content, setContent] = useState<ReactNode>(null)
    const [data, setData] = useState<any>(null)
    const [isOpen, setIsOpen] = useState<boolean>(false)

    const openModal = (content: ReactNode, data?: any) => {
        setContent(content);
        setData(data);
        setIsOpen(true);
    }

    const closeModal = () => {
        setIsOpen(false);
        setContent(null);
        setData(null);
    }

    return (
        <ModalContext.Provider value={{ openModal, closeModal, data, isOpen }}>
            {children}
            {isOpen && (
                <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur z-50">
                    <div className="relative p-3 w-md bg-(--secondary) inset-shadow-(--inset-shadow-primary) shadow-xl rounded-xl">
                        {content}
                    </div>
                </div>
            )}
        </ModalContext.Provider>
    )
}

export const useModal = () => {
    const ctx = useContext(ModalContext);
    if (!ctx) throw new Error("useModal must be used inside a ModalProvider");
    return ctx;
}