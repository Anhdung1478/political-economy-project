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

const Solo = lazy(() => import('./pages/Solo/Solo'));
const Host = lazy(() => import('./pages/Host/Host'));
const Play = lazy(() => import('./pages/Play/Play'));
// Dev builds only: `import.meta.env.DEV` is false in a production build, so the previews are not bundled.
const ScenePreview = import.meta.env.DEV ? lazy(() => import('./pages/Dev/ScenePreview')) : null;
const CharacterSheet = import.meta.env.DEV ? lazy(() => import('./pages/Dev/CharacterSheet')) : null;
const GamePreview = import.meta.env.DEV ? lazy(() => import('./pages/Dev/GamePreview')) : null;

const path = location.pathname.replace(/\/+$/, '') || '/';
const page = ScenePreview !== null && path === '/dev/scene' ? 'dev-scene'
  : CharacterSheet !== null && path === '/dev/characters' ? 'dev-characters'
  : GamePreview !== null && path === '/dev/game' ? 'dev-game'
  : path === '/host' ? 'host' : path === '/play' ? 'play' : 'solo';
document.documentElement.dataset.page = page;
const Page = page === 'dev-scene' && ScenePreview !== null ? ScenePreview
  : page === 'dev-characters' && CharacterSheet !== null ? CharacterSheet
  : page === 'dev-game' && GamePreview !== null ? GamePreview
  : page === 'host' ? Host : page === 'play' ? Play : Solo;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<div className="boot" aria-label="Đang tải"><span /><span /><span /></div>}>
        <Page />
      </Suspense>
    </MotionConfig>
  </StrictMode>,
);
