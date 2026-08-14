<?php

declare(strict_types=1);

namespace Sparkle\Referral;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Sparkle\Referral\Commands\CleanupExpiredClicks;
use Sparkle\Referral\Middleware\ReferralRateLimit;
use Sparkle\Referral\Services\ClickStore;
use Sparkle\Referral\Services\ConversionTracker;
use Sparkle\Referral\Services\FingerprintMatcher;
use Sparkle\Referral\Support\CodeValidator;
use Sparkle\Referral\Support\ReferralConfig;

class ReferralServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/Config/referral.php', 'referral');

        $this->app->singleton(ReferralConfig::class, function ($app) {
            return new ReferralConfig((array) $app['config']->get('referral', []));
        });

        $this->app->singleton(CodeValidator::class, function ($app) {
            return new CodeValidator($app['config']->get('referral.code_validator'));
        });

        // Services share the default connection's PDO handle so the whole SDK
        // works framework-free while still honoring Laravel's DB config.
        $pdo = fn ($app) => $app['db']->connection()->getPdo();

        $this->app->singleton(ClickStore::class, fn ($app) =>
            new ClickStore($pdo($app), $app->make(ReferralConfig::class)));

        $this->app->singleton(FingerprintMatcher::class, fn ($app) =>
            new FingerprintMatcher($pdo($app), $app->make(ReferralConfig::class)));

        $this->app->singleton(ConversionTracker::class, fn ($app) =>
            new ConversionTracker($pdo($app), $app->make(ReferralConfig::class)));
    }

    public function boot(Router $router): void
    {
        $router->aliasMiddleware('referral.throttle', ReferralRateLimit::class);

        $this->loadMigrationsFrom(__DIR__ . '/Migrations');
        $this->registerRoutes();

        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__ . '/Config/referral.php' => $this->app->configPath('referral.php'),
            ], 'referral-config');

            $this->publishes([
                __DIR__ . '/Migrations' => $this->app->databasePath('migrations'),
            ], 'referral-migrations');

            $this->commands([CleanupExpiredClicks::class]);
        }
    }

    private function registerRoutes(): void
    {
        $config = (array) $this->app['config']->get('referral.routes', []);

        if (!($config['enabled'] ?? true)) {
            return;
        }

        Route::group([
            'prefix'     => $config['prefix'] ?? 'api/referral',
            'middleware' => $config['middleware'] ?? ['api'],
        ], function () {
            $this->loadRoutesFrom(__DIR__ . '/../routes/api.php');
        });
    }
}
