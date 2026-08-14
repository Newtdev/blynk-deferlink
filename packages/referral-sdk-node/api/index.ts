import { createApp } from '../src/app.js';
import { configFromEnv } from '../src/configFromEnv.js';

// Vercel serverless entrypoint. An Express app instance is itself a valid
// `(req, res) => void` handler, so this is the same app built the same way
// as src/server.ts — no route/service logic is duplicated for serverless.
// vercel.json rewrites every request here; Express's own router (mounted at
// /api/referral inside createApp) does the path dispatch from there.
export default createApp(configFromEnv());
