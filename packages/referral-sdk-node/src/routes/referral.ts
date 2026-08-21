import { Router } from 'express';
import { z } from 'zod';
import type { ReferralConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { ClickStore } from '../services/clickStore.js';
import { ConversionTracker, resolveDeviceId } from '../services/conversionTracker.js';
import { FingerprintMatcher } from '../services/fingerprintMatcher.js';
import { RateLimiter } from '../services/rateLimiter.js';
import { isValidCode } from '../support/codeValidator.js';

const clickFingerprintSchema = z.object({
  user_agent: z.string().nullish(),
  screen_width: z.number().int().nullish(),
  screen_height: z.number().int().nullish(),
  pixel_ratio: z.number().nullish(),
  timezone: z.string().max(100).nullish(),
  // Real device locale identifiers can run longer than a bare BCP-47 primary
  // tag — iOS Simulator in particular reports "en_US_POSIX" (11 chars).
  // Only the primary subtag is ever compared (see languageMatches), so the
  // exact stored length doesn't matter beyond fitting a real-world value.
  language: z.string().max(35).nullish(),
  platform: z.string().max(50).nullish(),
  referrer: z.string().nullish(),
  referrer_url: z.string().nullish(),
});

const clickSchema = z.object({
  referral_code: z.string().min(1).max(50),
  fingerprint: clickFingerprintSchema,
});

const matchFingerprintSchema = z.object({
  user_agent: z.string().nullish(),
  device_model: z.string().max(100).nullish(),
  screen_width: z.number().int().nullish(),
  screen_height: z.number().int().nullish(),
  timezone: z.string().max(100).nullish(),
  // Real device locale identifiers can run longer than a bare BCP-47 primary
  // tag — iOS Simulator in particular reports "en_US_POSIX" (11 chars).
  // Only the primary subtag is ever compared (see languageMatches), so the
  // exact stored length doesn't matter beyond fitting a real-world value.
  language: z.string().max(35).nullish(),
});

const matchSchema = z.object({
  device_id: z.string().min(1).max(255),
  platform: z.enum(['ios', 'android']),
  // Present only for the deterministic redeem path (Android install
  // referrer, iOS clipboard) — the mobile SDK already has a click_id, so
  // scoring is skipped entirely in favor of a direct lookup + lock. Absent
  // for the probabilistic fingerprint path, where `method` is implicitly
  // 'fingerprint'. See decisions.md #21.
  click_id: z.string().min(1).max(36).nullish(),
  method: z.enum(['install_referrer', 'clipboard']).nullish(),
  fingerprint: matchFingerprintSchema,
});

const claimSchema = z.object({
  referral_code: z.string().min(1).max(50),
  device_id: z.string().min(1).max(255),
  platform: z.enum(['ios', 'android']),
  // Required now — this is the entire proof a real /click + /match (or
  // deterministic redeem) happened for this device. `method`/`confidence`
  // are no longer accepted here at all: they're derived server-side from
  // the click row this click_id references, not trusted from the request.
  // See decisions.md #21.
  click_id: z.string().min(1).max(36),
  user_id: z.string().max(255).nullish(),
});

/**
 * Builds the /referral/{click,match,claim} router. Framework glue only — all
 * real logic lives in src/services/*, ported from packages/referral-sdk
 * (PHP). Mount this under whatever prefix you like; the examples in this
 * repo mount it at /api/referral to match the mock backend's contract.
 */
export function referralRouter(db: Db, config: ReferralConfig): Router {
  const router = Router();
  const clicks = new ClickStore(db, config);
  const matcher = new FingerprintMatcher(db, config);
  const conversions = new ConversionTracker(db, config, clicks);
  const rateLimiter = new RateLimiter(db, config);
  const analytics = new AnalyticsService(db);

  router.post('/click', async (req, res, next) => {
    try {
      const parsed = clickSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(422).json({ success: false, error: 'invalid_request', details: parsed.error.flatten() });
      }

      const ip = clientIp(req);
      const throttle = await rateLimiter.check('click', ip);
      if (throttle.limited) {
        return res.status(429).json({ success: false, error: 'rate_limited', retry_after: throttle.retryAfter });
      }

      const { referral_code, fingerprint } = parsed.data;
      if (!(await isValidCode(referral_code, config))) {
        return res.status(422).json({ success: false, error: 'invalid_or_expired_code' });
      }

      const clickId = await clicks.store(referral_code, fingerprint, ip);
      return res.json({ success: true, click_id: clickId });
    } catch (err) {
      next(err);
    }
  });

  router.post('/match', async (req, res, next) => {
    try {
      const parsed = matchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(422).json({ success: false, error: 'invalid_request', details: parsed.error.flatten() });
      }

      const { device_id, platform, click_id, method, fingerprint } = parsed.data;
      const throttle = await rateLimiter.check('match', device_id);
      if (throttle.limited) {
        return res.status(429).json({ success: false, error: 'rate_limited', retry_after: throttle.retryAfter });
      }

      const storedDeviceId = resolveDeviceId(device_id, config);

      // Deterministic redeem: the client already knows click_id (Android
      // install referrer, iOS clipboard) — skip scoring entirely and go
      // straight to a lookup + lock. Falls through to a plain "no match"
      // (not an error) if the click is missing/expired/already claimed, so
      // the caller can fall back to fingerprint matching exactly like an
      // empty referrer does today. See decisions.md #21.
      if (click_id) {
        const candidate = await clicks.findUnmatchedClick(click_id);
        if (!candidate) {
          return res.json({ matched: false, referral_code: null });
        }
        if (!(await clicks.lockToDevice(click_id, storedDeviceId, method ?? 'install_referrer'))) {
          return res.json({ matched: false, referral_code: null });
        }
        return res.json({
          matched: true,
          referral_code: candidate.referralCode,
          click_id,
          match_method: method ?? 'install_referrer',
        });
      }

      const result = await matcher.match({
        ip: clientIp(req),
        platform,
        userAgent: fingerprint.user_agent,
        deviceModel: fingerprint.device_model,
        screenWidth: fingerprint.screen_width,
        screenHeight: fingerprint.screen_height,
        timezone: fingerprint.timezone,
        language: fingerprint.language,
        deviceId: device_id,
      });
      if (!result) {
        return res.json({ matched: false, referral_code: null });
      }

      // Lock atomically. If another request won the race, report no match
      // rather than handing the same click to two devices.
      if (!(await clicks.lockToDevice(result.clickId, storedDeviceId, 'fingerprint', result.confidence))) {
        return res.json({ matched: false, referral_code: null });
      }

      return res.json({
        matched: true,
        referral_code: result.referralCode,
        click_id: result.clickId,
        confidence: result.confidence,
        match_method: 'fingerprint',
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/claim', async (req, res, next) => {
    try {
      const parsed = claimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(422).json({ success: false, error: 'invalid_request', details: parsed.error.flatten() });
      }

      const data = parsed.data;
      const throttle = await rateLimiter.check('claim', data.device_id);
      if (throttle.limited) {
        return res.status(429).json({ success: false, error: 'rate_limited', retry_after: throttle.retryAfter });
      }

      if (!(await isValidCode(data.referral_code, config))) {
        return res.status(422).json({ success: false, error: 'invalid_or_expired_code' });
      }

      const result = await conversions.claim({
        referralCode: data.referral_code,
        deviceId: data.device_id,
        platform: data.platform,
        clickId: data.click_id,
        userId: data.user_id ?? null,
      });

      if (!result.success) {
        if ('unverified' in result) {
          // click_id doesn't reference a click locked to this device+code —
          // no real /click + /match (or deterministic redeem) happened.
          return res.status(403).json({ success: false, error: 'unverified_claim' });
        }
        return res.status(409).json({ success: false, error: result.duplicate ? 'already_claimed' : 'claim_failed' });
      }

      return res.json({ success: true, reward: result.reward });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Housekeeping only — matching already excludes expired clicks by query
   * (see FingerprintMatcher.match), so this endpoint is safe to run rarely.
   * Guard with CRON_SECRET and point your scheduler at it. Registered on
   * both GET and POST because Vercel Cron only ever issues GET requests;
   * a plain crontab (self-hosted) can use either.
   */
  router.all('/cleanup', async (req, res, next) => {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      if (!isAuthorizedCron(req)) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
      }
      const removed = await clicks.deleteExpired();
      return res.json({ success: true, removed });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /analytics — aggregate counts only (no per-row click/device data):
   * total clicks, matched count + rate, broken down by platform and by
   * referral_code. Guard with ANALYTICS_SECRET. Optional `?since=<ISO8601>`
   * query param restricts to clicks created at or after that time.
   */
  router.get('/analytics', async (req, res, next) => {
    try {
      if (!isAuthorizedAnalytics(req)) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
      }

      let since: Date | undefined;
      const rawSince = req.query.since;
      if (typeof rawSince === 'string' && rawSince.length > 0) {
        const parsed = new Date(rawSince);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(422).json({ success: false, error: 'invalid_since' });
        }
        since = parsed;
      }

      const stats = await analytics.getStats({ since });
      return res.json({ success: true, ...stats });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string }): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}

/**
 * Shared-secret check for internal/operational endpoints (cron cleanup,
 * analytics — anything not meant for the public web/mobile SDKs to call).
 * Accepts either `Authorization: Bearer <secret>` (what Vercel Cron sends
 * automatically once the corresponding env var is set) or a plain custom
 * header, for a self-hosted crontab or dashboard fetch.
 */
function isAuthorizedBySecret(
  req: { headers: Record<string, unknown> },
  envVar: string,
  headerName: string,
): boolean {
  const secret = process.env[envVar];
  if (!secret) return false; // refuse by default until explicitly configured

  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth === `Bearer ${secret}`) return true;

  return req.headers[headerName] === secret;
}

function isAuthorizedCron(req: { headers: Record<string, unknown> }): boolean {
  return isAuthorizedBySecret(req, 'CRON_SECRET', 'x-cron-secret');
}

function isAuthorizedAnalytics(req: { headers: Record<string, unknown> }): boolean {
  return isAuthorizedBySecret(req, 'ANALYTICS_SECRET', 'x-analytics-secret');
}
