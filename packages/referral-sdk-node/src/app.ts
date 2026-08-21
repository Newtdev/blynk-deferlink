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

  // How many reverse-proxy hops in front of this process to trust — NOT
  // `true` (trusts every hop, which means the client's own X-Forwarded-For
  // header is trusted too, letting them spoof clientIp() and defeat
  // per-IP rate limiting / IP-match scoring). Vercel is exactly one hop
  // (its edge), so TRUST_PROXY_HOPS=1 is correct there. Self-hosted
  // (Render/Fly/bare Node/local dev) needs whatever its real proxy chain's
  // hop count is — 0 (the safe default) if there's no proxy in front at
  // all. See decisions.md #23 and the README's deployment section.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 0);

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
