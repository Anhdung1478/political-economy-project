import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';

import { MotionConfig } from 'framer-motion';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const Presentation = lazy(() => import('./pages/Presentation/Presentation'));
const Host = lazy(() => import('./pages/Host/Host'));
const Play = lazy(() => import('./pages/Play/Play'));

const path = location.pathname.replace(/\/+$/, '') || '/';
const page = path === '/host' ? 'host' : path === '/play' ? 'play' : 'present';
document.documentElement.dataset.page = page;
const Page = page === 'host' ? Host : page === 'play' ? Play : Presentation;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<div className="boot" aria-label="Đang tải"><span /><span /><span /></div>}>
        <Page />
      </Suspense>
    </MotionConfig>
  </StrictMode>,
);
