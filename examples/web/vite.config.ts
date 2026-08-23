import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const sdkSrc = fileURLToPath(
  new URL('../../packages/referral-web/src/index.ts', import.meta.url),
);

// The SDK is consumed straight from source (no build step) via an alias, and
// React is deduped so the linked package shares the app's single copy.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@sparkle/referral-web': sdkSrc },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    // Allow importing files from the workspace root (outside this app dir).
    fs: { allow: ['../..'] },
  },
});
