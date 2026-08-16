-- Deferred deep linking referral SDK — schema for standalone (non-Laravel) installs.
-- Laravel users should run `php artisan migrate` instead.

CREATE TABLE IF NOT EXISTS referral_clicks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    click_id CHAR(36) NOT NULL UNIQUE,          -- UUID v4
    referral_code VARCHAR(50) NOT NULL,

    -- Fingerprint data
    ip_address VARCHAR(45) NOT NULL,            -- IPv4 or IPv6
    user_agent TEXT,
    screen_width INT,
    screen_height INT,
    pixel_ratio DECIMAL(3,2),
    timezone VARCHAR(100),
    language VARCHAR(10),
    platform VARCHAR(50),
    referrer_url TEXT,

    -- Matching state
    matched BOOLEAN DEFAULT FALSE,
    matched_device_id VARCHAR(255) NULL,        -- Locked after match
    matched_at TIMESTAMP NULL,

    -- Meta
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,              -- created_at + match window

    INDEX idx_ip_created (ip_address, created_at),
    INDEX idx_code (referral_code),
    INDEX idx_expires (expires_at),
    INDEX idx_match_scan (matched, expires_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referral_conversions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    click_id CHAR(36) NOT NULL,
    referral_code VARCHAR(50) NOT NULL,
    device_id VARCHAR(255) NOT NULL UNIQUE,     -- One referral per device
    platform ENUM('ios', 'android') NOT NULL,
    match_method ENUM('install_referrer', 'fingerprint', 'clipboard') NOT NULL,
    match_confidence DECIMAL(5,2),              -- 0.00 to 100.00
    user_id VARCHAR(255) NULL,                  -- Set after user signs up
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_device (device_id),
    INDEX idx_user (user_id),
    INDEX idx_code (referral_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
