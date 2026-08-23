<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Support;

/**
 * Best-effort user-agent / device-model normalizer.
 *
 * Two very different strings need to be compared during fingerprint matching:
 *
 *   - The stored click carries a *browser* User-Agent
 *     (e.g. "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) ...").
 *   - The match request carries a *native* device model reported by the app
 *     (e.g. "iPhone14,5" on iOS, "Pixel 7" / "SM-G991B" on Android).
 *
 * These share no exact substring, so we reduce both to a coarse signature:
 * an OS family plus (when available) a major OS version. On iOS a Safari UA
 * never exposes the marketing/model identifier, so device-level matching there
 * necessarily collapses to OS-family + version. That is the accepted limit
 * behind the ~85-90% iOS reliability figure in the spec.
 */
final class UserAgentParser
{
    /**
     * @return array{os: string, os_version: ?string, model_hint: ?string}
     */
    public static function parse(?string $ua): array
    {
        $ua = (string) $ua;

        $os = 'unknown';
        $osVersion = null;
        $modelHint = null;

        if (preg_match('/iPhone|iPad|iPod/i', $ua)) {
            $os = 'ios';
            if (preg_match('/OS (\d+)[_.](\d+)/i', $ua, $m)) {
                $osVersion = $m[1] . '.' . $m[2];
            }
            if (preg_match('/(iPhone|iPad|iPod)/i', $ua, $m)) {
                $modelHint = strtolower($m[1]);
            }
        } elseif (preg_match('/Android/i', $ua)) {
            $os = 'android';
            if (preg_match('/Android (\d+)(?:\.(\d+))?/i', $ua, $m)) {
                $osVersion = $m[1] . '.' . ($m[2] ?? '0');
            }
            // Try to pull a build/model token: "...; Pixel 7 Build/..." or "...; SM-G991B)"
            if (preg_match('/;\s*([^;)]+?)\s*(?:Build\/|\))/i', $ua, $m)) {
                $modelHint = self::normalizeModel($m[1]);
            }
        } elseif (preg_match('/Windows|Macintosh|Linux|CrOS/i', $ua)) {
            $os = 'desktop';
        }

        return [
            'os' => $os,
            'os_version' => $osVersion,
            'model_hint' => $modelHint,
        ];
    }

    /**
     * Normalize a native device-model identifier reported by the mobile app.
     * Accepts values like "iPhone14,5", "iPhone 14 Pro", "Pixel 7", "SM-G991B".
     *
     * @return array{os: string, model_hint: ?string}
     */
    public static function parseModel(?string $model, ?string $platform = null): array
    {
        $model = (string) $model;
        $platform = strtolower((string) $platform);

        $os = 'unknown';
        if ($platform === 'ios' || preg_match('/iPhone|iPad|iPod/i', $model)) {
            $os = 'ios';
        } elseif ($platform === 'android' || $model !== '') {
            // Any non-Apple model string with platform android, or a bare model.
            $os = $platform === 'android' ? 'android' : $os;
        }

        return [
            'os' => $os,
            'model_hint' => self::normalizeModel($model),
        ];
    }

    private static function normalizeModel(string $value): ?string
    {
        $value = strtolower(trim($value));
        // Strip common noise tokens found in Android UA fragments.
        $value = preg_replace('/\b(mobile|wv|k|android|build)\b/i', '', $value) ?? $value;
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? $value);

        return $value === '' ? null : $value;
    }
}
