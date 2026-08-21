/**
 * Mock referral backend — a zero-dependency stand-in for `sparkle/referral-sdk`
 * (the PHP package) so the web + mobile examples can run end-to-end with just
 * Node. It keeps clicks in memory and mirrors the same fingerprint scoring, so
 * a click → match → claim flow behaves like the real thing. NOT for production.
 *
 *   node server.js            # listens on http://0.0.0.0:8787
 */

const http = require('http');

const PORT = process.env.PORT || 8787;
const MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_CONFIDENCE = 70;
const WEIGHTS = { ip: 40, device: 25, screen: 15, timezone: 10, language: 10 };

/** @type {Array<any>} */
const clicks = [];
/** @type {Set<string>} */
const convertedDevices = new Set();

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
    const click = {
      click_id: uuid(),
      referral_code: body.referral_code,
      ip_address: ip,
      created_at: Date.now(),
      matched: false,
      ...(body.fingerprint || {}),
    };
    clicks.push(click);
    console.log(`  click stored  code=${click.referral_code} ip=${ip} id=${click.click_id.slice(0, 8)}`);
    return [200, { success: true, click_id: click.click_id }];
  },

  '/api/referral/match': (body, ip) => {
    // Deterministic redeem: the client already knows click_id (Android
    // install referrer, iOS clipboard) — skip scoring entirely, go straight
    // to a lookup + lock. Mirrors routes/referral.ts's deterministic
    // fast-path — see docs/decisions.md #21.
    if (body.click_id) {
      const click = clicks.find((c) => c.click_id === body.click_id);
      if (!click || click.matched || Date.now() - click.created_at > MATCH_WINDOW_MS) {
        console.log(`  match miss    (deterministic, click_id=${String(body.click_id).slice(0, 8)})`);
        return [200, { matched: false, referral_code: null }];
      }
      const method = body.method || 'install_referrer';
      click.matched = true;
      click.matched_device_id = body.device_id;
      click.match_method = method;
      click.match_confidence = null;
      console.log(`  match hit     code=${click.referral_code} method=${method} (deterministic)`);
      return [200, { matched: true, referral_code: click.referral_code, click_id: click.click_id, match_method: method }];
    }

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
    console.log(`  match hit     code=${best.referral_code} confidence=${bestScore}`);
    return [
      200,
      { matched: true, referral_code: best.referral_code, click_id: best.click_id, confidence: bestScore, match_method: 'fingerprint' },
    ];
  },

  '/api/referral/claim': (body) => {
    if (!body.referral_code) return [422, { success: false, error: 'invalid_or_expired_code' }];
    if (!body.click_id) return [422, { success: false, error: 'invalid_request' }];

    // The entire proof: click_id must reference a click this exact device
    // already won the lock on, for the exact code being claimed — nothing
    // else in the request body is trusted. See docs/decisions.md #21.
    const click = clicks.find((c) => c.click_id === body.click_id);
    if (!click || !click.matched || click.matched_device_id !== body.device_id || click.referral_code !== body.referral_code) {
      console.log(`  claim REJECTED unverified click_id=${String(body.click_id).slice(0, 8)}`);
      return [403, { success: false, error: 'unverified_claim' }];
    }

    if (convertedDevices.has(body.device_id)) return [409, { success: false, error: 'already_claimed' }];
    convertedDevices.add(body.device_id);
    console.log(`  claim ok      code=${body.referral_code} device=${String(body.device_id).slice(0, 12)}`);
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

module.exports = { score, routes, clicks, convertedDevices };
