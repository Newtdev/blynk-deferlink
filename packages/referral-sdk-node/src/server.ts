import 'dotenv/config';
import { createApp } from './app.js';
import { configFromEnv } from './configFromEnv.js';

// Standalone long-running server — for local dev, Render, Fly, or any bare
// Node host. Vercel does NOT use this file; see api/index.ts, which mounts
// the exact same app built by createApp().
const app = createApp(configFromEnv());
const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Referral backend (Node) on http://localhost:${port}`);
  console.log('POST /api/referral/{click,match,claim}');
});
