<?php

declare(strict_types=1);

namespace Sparkle\Referral\Tests;

use PHPUnit\Framework\TestCase;
use Sparkle\Referral\Support\ClickToken;

final class ClickTokenTest extends TestCase
{
    private const SECRET = 'test-secret-do-not-use-in-prod';

    private function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('2026-08-14T12:00:00Z');
    }

    public function test_signs_and_verifies_a_valid_token_round_trip(): void
    {
        $expiresAt = $this->now()->modify('+60 seconds');
        $token = ClickToken::sign('click-abc-123', $expiresAt, self::SECRET);
        $result = ClickToken::verify($token, self::SECRET, $this->now());
        $this->assertSame(['click_id' => 'click-abc-123'], $result);
    }

    public function test_rejects_a_tampered_click_id(): void
    {
        $expiresAt = $this->now()->modify('+60 seconds');
        $token = ClickToken::sign('click-abc-123', $expiresAt, self::SECRET);
        [, $exp, $sig] = explode('.', $token);
        $tampered = "click-attacker-999.{$exp}.{$sig}";
        $this->assertNull(ClickToken::verify($tampered, self::SECRET, $this->now()));
    }

    public function test_rejects_a_tampered_expiry(): void
    {
        $expiresAt = $this->now()->modify('+60 seconds');
        $token = ClickToken::sign('click-abc-123', $expiresAt, self::SECRET);
        [$clickId, $exp, $sig] = explode('.', $token);
        $tampered = "{$clickId}." . ((int) $exp + 999999) . ".{$sig}";
        $this->assertNull(ClickToken::verify($tampered, self::SECRET, $this->now()));
    }

    public function test_rejects_a_token_signed_with_a_different_secret(): void
    {
        $expiresAt = $this->now()->modify('+60 seconds');
        $token = ClickToken::sign('click-abc-123', $expiresAt, self::SECRET);
        $this->assertNull(ClickToken::verify($token, 'wrong-secret', $this->now()));
    }

    public function test_rejects_an_expired_token(): void
    {
        $expiresAt = $this->now()->modify('-1 second');
        $token = ClickToken::sign('click-abc-123', $expiresAt, self::SECRET);
        $this->assertNull(ClickToken::verify($token, self::SECRET, $this->now()));
    }

    public function test_accepts_a_token_exactly_at_the_expiry_boundary(): void
    {
        $token = ClickToken::sign('click-abc-123', $this->now(), self::SECRET);
        $result = ClickToken::verify($token, self::SECRET, $this->now());
        $this->assertSame(['click_id' => 'click-abc-123'], $result);
    }

    public function test_rejects_malformed_tokens(): void
    {
        $this->assertNull(ClickToken::verify('', self::SECRET, $this->now()));
        $this->assertNull(ClickToken::verify('not-a-token', self::SECRET, $this->now()));
        $this->assertNull(ClickToken::verify('only.two-parts', self::SECRET, $this->now()));
        $this->assertNull(ClickToken::verify('a.b.c.d', self::SECRET, $this->now()));
        $this->assertNull(ClickToken::verify('click-id.not-a-number.deadbeef', self::SECRET, $this->now()));
    }

    public function test_a_completely_fabricated_token_is_rejected(): void
    {
        // No prior /click ever happened — an attacker just makes something up.
        $fabricated = 'attacker-click-id.9999999999.' . str_repeat('deadbeef', 8);
        $this->assertNull(ClickToken::verify($fabricated, self::SECRET, $this->now()));
    }
}
