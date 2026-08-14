/**
 * Best-effort user-agent / device-model normalizer. Ported line-for-line from
 * packages/referral-sdk/src/Support/UserAgentParser.php — keep the two in
 * sync if the matching heuristics ever change.
 *
 * Two very different strings need to be compared during fingerprint matching:
 *   - The stored click carries a *browser* User-Agent
 *     (e.g. "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) ...").
 *   - The match request carries a *native* device model reported by the app
 *     (e.g. "iPhone14,5" on iOS, "Pixel 7" / "SM-G991B" on Android).
 * These share no exact substring, so both are reduced to a coarse signature:
 * an OS family plus (when available) a major OS version.
 */
export interface UaSignature {
  os: 'ios' | 'android' | 'desktop' | 'unknown';
  osVersion: string | null;
  modelHint: string | null;
}

export function parseUa(ua: string | null | undefined): UaSignature {
  const s = ua ?? '';

  if (/iPhone|iPad|iPod/i.test(s)) {
    const m = s.match(/OS (\d+)[_.](\d+)/i);
    const model = s.match(/(iPhone|iPad|iPod)/i);
    return {
      os: 'ios',
      osVersion: m ? `${m[1]}.${m[2]}` : null,
      modelHint: model ? model[1].toLowerCase() : null,
    };
  }

  if (/Android/i.test(s)) {
    const m = s.match(/Android (\d+)(?:\.(\d+))?/i);
    const build = s.match(/;\s*([^;)]+?)\s*(?:Build\/|\))/i);
    return {
      os: 'android',
      osVersion: m ? `${m[1]}.${m[2] ?? '0'}` : null,
      modelHint: build ? normalizeModel(build[1]) : null,
    };
  }

  if (/Windows|Macintosh|Linux|CrOS/i.test(s)) {
    return { os: 'desktop', osVersion: null, modelHint: null };
  }

  return { os: 'unknown', osVersion: null, modelHint: null };
}

/**
 * Normalize a native device-model identifier reported by the mobile app.
 * Accepts values like "iPhone14,5", "iPhone 14 Pro", "Pixel 7", "SM-G991B".
 */
export function parseModel(
  model: string | null | undefined,
  platform: string | null | undefined,
): { os: UaSignature['os']; modelHint: string | null } {
  const m = model ?? '';
  const p = (platform ?? '').toLowerCase();

  let os: UaSignature['os'] = 'unknown';
  if (p === 'ios' || /iPhone|iPad|iPod/i.test(m)) {
    os = 'ios';
  } else if (p === 'android' && m !== '') {
    os = 'android';
  }

  return { os, modelHint: normalizeModel(m) };
}

function normalizeModel(value: string): string | null {
  let v = value.toLowerCase().trim();
  v = v.replace(/\b(mobile|wv|k|android|build)\b/gi, '');
  v = v.replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}
