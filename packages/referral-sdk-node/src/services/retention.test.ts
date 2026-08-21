import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../db/client.js';
import { referralMatchAttempts, referralRateLimitHits } from '../db/schema.js';
import { RetentionService } from './retention.js';

/**
 * `referral_match_attempts` and `referral_rate_limit_hits` grew unbounded
 * forever before this — only `referral_clicks` had a cleanup path (see
 * decisions.md #23). This proves purgeOld() reaches both tables and
 * reports counts from each independently, using a stub db that mimics
 * drizzle's delete().where().returning() chain rather than a real
 * connection — full purge behavior against a real database is verified
 * live post-deploy, same as every other DB-touching change this session.
 */
function stubDb(returns: { matchAttempts: unknown[]; rateLimitHits: unknown[] }): Db {
  return {
    delete: (table: unknown) => ({
      where: () => ({
        returning: async () => {
          if (table === referralMatchAttempts) return returns.matchAttempts;
          if (table === referralRateLimitHits) return returns.rateLimitHits;
          throw new Error('unexpected table passed to delete()');
        },
      }),
    }),
  } as unknown as Db;
}

test('purgeOld deletes from both tables and reports each count separately', async () => {
  const db = stubDb({ matchAttempts: [{ id: 1 }, { id: 2 }], rateLimitHits: [{ id: 1 }] });
  const service = new RetentionService(db);

  const result = await service.purgeOld(30);

  assert.deepEqual(result, { matchAttemptsRemoved: 2, rateLimitHitsRemoved: 1 });
});

test('purgeOld reports zero for both when nothing is old enough to purge', async () => {
  const db = stubDb({ matchAttempts: [], rateLimitHits: [] });
  const service = new RetentionService(db);

  const result = await service.purgeOld(30);

  assert.deepEqual(result, { matchAttemptsRemoved: 0, rateLimitHitsRemoved: 0 });
});
