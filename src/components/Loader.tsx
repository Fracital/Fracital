import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { ArrowLeftIcon, ArrowRightIcon, ChevronLeftIcon, StarIcon } from "@heroicons/react/24/solid";
import { HolyText } from "./common/HolyText";

interface LoaderProps {
    type?: 'skeleton' | 'dots';
}

export const Loader: React.FC<LoaderProps> = ({ type = 'skeleton' }) => {
    if (type === 'skeleton') {
        return (
            <div className="flex flex-col size-full">
                <div className="flex items-center gap-2.5 p-3 h-20 w-full animate-[pulse_1.6s_infinite]">
                    <div className="bg-[#232323] inset-shadow-[0_0_0_4px_#ffffff10] size-10.5 rounded-full"></div>
                    <div className="flex gap-2 items-center">
                        <ArrowPathIcon className="size-6.5 stroke-[2.5] stroke-[#303030]" />
                        <ArrowLeftIcon className="size-6.5 stroke-1 stroke-[#333333] text-[#333333]" />
                        <ArrowRightIcon className="size-6.5 stroke-1 stroke-[#333333] text-[#333333]" />
                        <StarIcon className="size-7 stroke-1 stroke-[#333333] text-[#333333]" />
                    </div>
                    <div className="bg-[#232323] inset-shadow-[0_0_0_2.5px_#ffffff10] h-12 w-68 rounded-xl"></div>
                </div>
                <div className="flex gap-2.5 p-3 pt-0 pr-0 size-full">
                    <div className="bg-[#232323] inset-shadow-[0_0_0_2px_#ffffff10] h-full w-full rounded-xl">
                        <div className="flex flex-col items-center justify-center h-full -mt-14 gap-4 p-4 animate-[pulse_1.6s_infinite]">
                            <h1 className="text-7xl font-black leading-none text-[#ffffff10]"><HolyText text="FRACITAL" /></h1>
                            <div className="flex items-center gap-4">
                                <div className="w-55 h-33 bg-white/10 rounded-2xl"></div>
                                <div className="w-55 h-33 bg-white/10 rounded-2xl"></div>
                                <div className="w-55 h-33 bg-white/10 rounded-2xl"></div>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-center bg-[#232323] inset-shadow-[0_0_0_2px_#ffffff10] h-max w-10 rounded-xl p-1.5 py-2">
                            <ChevronLeftIcon className="size-6 stroke-1 stroke-[#333333] text-[#333333]" />
                        </div>
                        <div className="bg-[#232323] inset-shadow-[0_0_0_2px_#ffffff10] h-full w-13 rounded-l-xl"></div>
                        <div className="bg-[#232323] inset-shadow-[0_0_0_2px_#ffffff10] h-40 w-13 rounded-l-xl"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex space-x-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce"></div>
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>
    );
};