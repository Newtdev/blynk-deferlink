import cors from 'cors';
import express, { type Express } from 'express';
import { ReferralConfig, type ReferralConfigInput } from './config.js';
import { getDb } from './db/client.js';
import { referralRouter } from './routes/referral.js';

/**
 * Builds the referral backend as a single Express app. This is the ONE
 * implementation: `src/server.ts` calls `app.listen()` on it for a normal
 * long-running process (Render, Fly, bare Node, local dev), and `api/index.ts`
 * exports the exact same app for Vercel — an Express app instance is itself
 * a valid `(req, res)` handler, so Vercel's Node runtime can serve it
 * directly with zero serverless-specific rewrite. Nothing about the routes,
 * services, or DB access differs between the two.
 */
export function createApp(configInput: ReferralConfigInput = {}): Express {
  const config = new ReferralConfig(configInput);
  const db = getDb();

  const app = express();

  // Requests arrive via Vercel's (or any) reverse proxy — trust its
  // X-Forwarded-For so rate limiting and click IPs reflect the real client.
  app.set('trust proxy', true);

  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/referral', referralRouter(db, config));

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
