<?php

declare(strict_types=1);

namespace BlynkDeferlink\Referral\Support;

/**
 * Referral codes belong to the host application, not this SDK, so validation
 * is delegated. Point `referral.code_validator` at either:
 *
 *   - a callable: fn (string $code): bool
 *   - a class name with a public `validate(string $code): bool` method
 *
 * When nothing is configured, any non-empty code is accepted. Configure a
 * real validator in production so clicks are only stored for live codes.
 */
final class CodeValidator
{
    /** @var callable|string|null */
    private $validator;

    public function __construct(callable|string|null $validator = null)
    {
        $this->validator = $validator;
    }

    public function isValid(string $code): bool
    {
        $code = trim($code);
        if ($code === '') {
            return false;
        }

        $validator = $this->validator;

        if (is_string($validator) && class_exists($validator) && method_exists($validator, 'validate')) {
            return (bool) (new $validator())->validate($code);
        }

        if (is_callable($validator)) {
            return (bool) $validator($code);
        }

        // No validator configured — accept any non-empty code.
        return true;
    }
}
