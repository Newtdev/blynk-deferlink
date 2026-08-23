/**
 * Mock referral backend — a zero-dependency stand-in for `blynk-deferlink/referral-sdk`
 * (the PHP package) so the web + mobile examples can run end-to-end with just
 * Node. It keeps clicks in memory and mirrors the same fingerprint scoring, so
 * a click → match → claim flow behaves like the real thing. NOT for production.
 *
 *   node server.js            # listens on http://0.0.0.0:8787
 */

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8787;
const MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_CONFIDENCE = 70;
const WEIGHTS = { ip: 40, device: 25, screen: 15, timezone: 10, language: 10 };

// Dev-only, hardcoded — a real deployment requires CLICK_TOKEN_SECRET to be
// set explicitly (see support/clickToken.ts / Support/ClickToken.php) and
// refuses to run without it. See docs/decisions.md #22.
const CLICK_TOKEN_SECRET = 'mock-backend-dev-secret-not-for-production';

/** @type {Array<any>} */
const clicks = [];
/** @type {Set<string>} */
const convertedDevices = new Set();

// --- click token (mirrors support/clickToken.ts) -----------------------------

function signClickToken(clickId, expiresAtMs) {
  const exp = Math.floor(expiresAtMs / 1000);
  const payload = `${clickId}.${exp}`;
  const sig = crypto.createHmac('sha256', CLICK_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyClickToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [clickId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!clickId || !sig || !Number.isFinite(exp)) return null;
  const expected = crypto.createHmac('sha256', CLICK_TOKEN_SECRET).update(`${clickId}.${expRaw}`).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  return { clickId };
}

// --- fingerprint helpers (ported from FingerprintMatcher) -------------------

function parseUa(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const m = ua.match(/OS (\d+)[_.](\d+)/i);
    return { os: 'ios', version: m ? `${m[1]}.${m[2]}` : null };
  }
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android (\d+)(?:\.(\d+))?/i);
    return { os: 'android', version: m ? `${m[1]}.${m[2] ?? 0}` : null };
  }
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return { os: 'desktop', version: null };
  return { os: 'unknown', version: null };
}

function incomingDeviceOs(fp) {
  const model = (fp.device_model || '').toString();
  if (fp.platform === 'ios' || /iPhone|iPad|iPod/i.test(model)) return { os: 'ios', version: null };
  if (fp.platform === 'android') return { os: 'android', version: null };
  return parseUa(fp.user_agent);
}

function deviceMatches(stored, incoming) {
  if (stored.os === 'unknown' || incoming.os === 'unknown') return false;
  if (stored.os !== incoming.os) return false;
  if (stored.version && incoming.version) {
    return stored.version.split('.')[0] === incoming.version.split('.')[0];
  }
  return true;
}

function screenMatches(a, b) {
  const [aw, ah, bw, bh] = [a.screen_width, a.screen_height, b.screen_width, b.screen_height].map(Number);
  if (!aw || !ah || !bw || !bh) return false;
  return (aw === bw && ah === bh) || (aw === bh && ah === bw);
}

function langMatches(a = '', b = '') {
  if (!a || !b) return false;
  return a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];
}

function score(stored, incoming) {
  let s = 0;
  if (stored.ip_address && stored.ip_address === incoming.ip) s += WEIGHTS.ip;
  if (deviceMatches(parseUa(stored.user_agent), incomingDeviceOs(incoming))) s += WEIGHTS.device;
  if (screenMatches(stored, incoming)) s += WEIGHTS.screen;
  if (stored.timezone && incoming.timezone && stored.timezone === incoming.timezone) s += WEIGHTS.timezone;
  if (langMatches(stored.language, incoming.language)) s += WEIGHTS.language;
  return s;
}

// --- tiny helpers -----------------------------------------------------------

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  '0.0.0.0';

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// --- routes -----------------------------------------------------------------

const routes = {
  '/api/referral/click': (body, ip) => {
    if (!body.referral_code) return [422, { success: false, error: 'invalid_or_expired_code' }];
    const clickId = uuid();
    const expiresAtMs = Date.now() + MATCH_WINDOW_MS;
    const click = {
      click_id: clickId,
      referral_code: body.referral_code,
      ip_address: ip,
      created_at: Date.now(),
      expires_at: expiresAtMs,
      matched: false,
      ...(body.fingerprint || {}),
    };
    clicks.push(click);
    // Signed for free, right here — the same thing that lets the
    // deterministic recovery paths (Android referrer, iOS clipboard) stay
    // fully local and network-free. See docs/decisions.md #22.
    const token = signClickToken(clickId, expiresAtMs);
    console.log(`  click stored  code=${click.referral_code} ip=${ip} id=${clickId.slice(0, 8)}`);
    return [200, { success: true, click_id: clickId, token }];
  },

  '/api/referral/match': (body, ip) => {
    // Probabilistic fingerprint matching only — the deterministic paths
    // (Android referrer, iOS clipboard) never call this at all anymore;
    // they redeem the click-minted token directly at /claim. See
    // docs/decisions.md #22.
    const fp = { ...(body.fingerprint || {}), platform: body.platform, ip };
    let best = null;
    let bestScore = 0;
    for (const c of clicks) {
      if (c.matched) continue;
      if (Date.now() - c.created_at > MATCH_WINDOW_MS) continue;
      const s = score(c, fp);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best || bestScore < MIN_CONFIDENCE) {
      console.log(`  match miss    best=${bestScore}`);
      return [200, { matched: false, referral_code: null }];
    }
    best.matched = true;
    best.matched_device_id = body.device_id;
    best.match_method = 'fingerprint';
    best.match_confidence = bestScore;
    const token = signClickToken(best.click_id, best.expires_at);
    console.log(`  match hit     code=${best.referral_code} confidence=${bestScore}`);
    return [
      200,
      { matched: true, referral_code: best.referral_code, click_id: best.click_id, token, confidence: bestScore, match_method: 'fingerprint' },
    ];
  },

  '/api/referral/claim': (body) => {
    if (!body.token) return [422, { success: false, error: 'invalid_request' }];

    const verified = verifyClickToken(body.token);
    if (!verified) {
      console.log('  claim REJECTED invalid/expired/tampered token');
      return [403, { success: false, error: 'unverified_claim' }];
    }

    const click = clicks.find((c) => c.click_id === verified.clickId);
    if (!click || click.expires_at < Date.now()) {
      console.log(`  claim REJECTED unknown/expired click click_id=${verified.clickId.slice(0, 8)}`);
      return [403, { success: false, error: 'unverified_claim' }];
    }

    let matchMethod;
    if (click.matched) {
      // Fingerprint path — /match already locked this click. Confirm the
      // lock belongs to this device; nothing to lock here.
      if (click.matched_device_id !== body.device_id) {
        console.log(`  claim REJECTED wrong device for locked click click_id=${verified.clickId.slice(0, 8)}`);
        return [403, { success: false, error: 'unverified_claim' }];
      }
      matchMethod = click.match_method ?? 'fingerprint';
    } else {
      // Deterministic path's first real use — lock it right here.
      matchMethod = body.method || 'fingerprint';
      click.matched = true;
      click.matched_device_id = body.device_id;
      click.match_method = matchMethod;
    }

    if (convertedDevices.has(body.device_id)) return [409, { success: false, error: 'already_claimed' }];
    convertedDevices.add(body.device_id);
    console.log(`  claim ok      code=${click.referral_code} method=${matchMethod} device=${String(body.device_id).slice(0, 12)}`);
    return [200, { success: true, reward: { type: 'credit', amount: 500 } }];
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url.split('?')[0];
  const handler = routes[url];
  if (req.method !== 'POST' || !handler) return send(res, 404, { error: 'not_found' });
  const body = await readBody(req);
  const [code, payload] = handler(body, clientIp(req));
  send(res, code, payload);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Mock referral backend on http://localhost:${PORT}`);
    console.log('POST /api/referral/{click,match,claim}\n');
  });
}

module.exports = { score, signClickToken, verifyClickToken, routes, clicks, convertedDevices };
