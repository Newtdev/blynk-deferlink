import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoPage } from './DemoPage';
import { PrivacyPage } from './PrivacyPage';

// No router dependency — this is a small example app. Vercel's SPA rewrite
// (vercel.json) already sends every path to index.html, so /demo and
// /privacy resolve here with no deploy-config changes.
const path = window.location.pathname;
const page = path === '/demo' ? <DemoPage /> : path === '/privacy' ? <PrivacyPage /> : <App />;

createRoot(document.getElementById('root')!).render(<React.StrictMode>{page}</React.StrictMode>);
