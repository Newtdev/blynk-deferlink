import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/**
 * Neon's HTTP driver (not a TCP pool) is used deliberately: it works
 * identically inside a long-running Node process (Render, Fly, local dev)
 * and inside a stateless Vercel serverless function, since every query is
 * just a `fetch()` call rather than a held connection. That's what lets
 * src/app.ts stay a single implementation across both deploy targets — no
 * connection-pool warmup/teardown logic to fork between them.
 */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Lazily instantiated so importing this module (e.g. from tooling, or from a
// route that never touches the DB) doesn't require DATABASE_URL to already
// be set. The instance is memoized on the module — which Vercel reuses
// across warm invocations of the same function, same as any other module.
let instance: Db | undefined;

export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at your Neon connection string.',
    );
  }
  instance = drizzle(neon(url), { schema });
  return instance;
}
