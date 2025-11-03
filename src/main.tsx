import { useEffect, useState } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import App from './App'
import './index.css'
import { init } from './libs/init';
import { fileExists } from './types';
import { Setup } from './Setup';

const Root = () => {
  const [isSetup, setIsSetup] = useState<null | boolean>(true);
  useEffect(() => {
    let cancelled = false;
    const waitForFs = async () => {
      while (!cancelled && !(window as any).fr?.fs) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!cancelled) {
        init();
      }
    };
    waitForFs();
    return () => {
      cancelled = true;
    };
  }, []);

  // useEffect(() => {
  //   const checkSetup = async () => {
  //     // Wait for Filer to be ready if needed
  //     try {
  //       const exists = await fileExists('/settings/settings.json');
  //       // setIsSetup(exists);
  //     } catch (e) {
  //       // setIsSetup(false);
  //     }
  //   };
  //   checkSetup();
  // }, []);

  // if (isSetup === null) return null; // or a loading spinner
  // if (!isSetup) return <Setup />;
  return <App />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
)
