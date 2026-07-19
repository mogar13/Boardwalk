import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { browserStaleBuildHost, installStaleBuildRecovery } from '@/system/staleBuild/staleBuild';

// Before anything renders: a lazy chunk from a build that no longer exists must reload the page
// rather than white-screen it. This app is split per game and per system module, so the window
// after a deploy where `Lobby`, `cards` or a game chunk 404s is not hypothetical.
installStaleBuildRecovery(browserStaleBuildHost());

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
