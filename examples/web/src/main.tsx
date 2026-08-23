import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoPage } from './DemoPage';

// No router dependency — this is a two-page example app. Vercel's SPA
// rewrite (vercel.json) already sends every path to index.html, so /demo
// resolves here with no deploy-config changes.
const page = window.location.pathname === '/demo' ? <DemoPage /> : <App />;

createRoot(document.getElementById('root')!).render(<React.StrictMode>{page}</React.StrictMode>);
