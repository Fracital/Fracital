import { Routes, Route, Link } from 'react-router-dom';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Shell from './gui/Shell';

import Home from './views/Home';
import Settings from './views/Settings';
import ExternalSite from './views/ExternalSite';

const App = () => {
    return (
        <div className="flex flex-col size-full gap-2.5 p-3">
            <Shell />
            <div className="flex flex-col size-full gap-[1px]">
                <div className="h-full bg-secondary inset-shadow-primary rounded-t-xl">
                    <Routes>
                        <Route path="/es" element={<ExternalSite />} />
                        <Route path="/" element={<Home />} />
                        <Route path="/settings" element={<Settings />} />
                    </Routes>
                </div>
                <div className="flex items-center bg-secondary inset-shadow-primary mt-0.5 rounded-b-lg w-full overflow-hidden">
                    <Link target="_blank" to="/LICENSE.txt" className="flex items-center h-full px-2.5 leading-none text-text-quaternary font-bold text-lg hover:bg-quaternary duration-150">© Fracital 2025</Link>
                    <div className="flex gap-1.5 p-1.5">
                        <Link target="_blank" to="https://discord.gg/unblock" className="flex items-center gap-1.5 text-text-quaternary hover:text-text-tertiary font-bold text-lg">
                            <FontAwesomeIcon icon={faDiscord} className="text-current duration-150" />
                            <span className="text-current duration-150">Discord</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;