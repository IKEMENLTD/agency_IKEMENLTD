-- ================================================================
-- 株式会社イケメン 代理店管理システム
-- サービステーブル セットアップスクリプト（完璧版）
-- ================================================================
--
-- 実行手順:
-- 1. https://supabase.com/dashboard にアクセス
-- 2. プロジェクト選択 → SQL Editor
-- 3. このファイルの内容をコピー&ペースト
-- 4. Run をクリック
--
-- ================================================================

-- ================================================================
-- STEP 1: テーブル作成
-- ================================================================

-- 1-1. servicesテーブルの作成
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    domain VARCHAR(255),
    line_official_url TEXT,  -- LINE公式アカウント友達追加URL
    app_redirect_url TEXT,   -- アプリへのリダイレクトURL（任意）
    default_commission_rate NUMERIC(5,2) DEFAULT 20.00,  -- 基本統括報酬率: 粗利の20%
    default_referral_rate NUMERIC(5,2) DEFAULT 0.00,
    subscription_price NUMERIC(10,2),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 1-2. nameカラムにUNIQUE制約を追加（既に存在する場合はエラーを無視）
DO $$
BEGIN
    ALTER TABLE services ADD CONSTRAINT services_name_unique UNIQUE (name);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

-- 1-3. agency_service_settingsテーブルの作成
CREATE TABLE IF NOT EXISTS agency_service_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    service_id UUID NOT NULL,
    commission_rate NUMERIC(5,2),
    referral_rate NUMERIC(5,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 1-4. agency_service_settingsにUNIQUE制約を追加
DO $$
BEGIN
    ALTER TABLE agency_service_settings
    ADD CONSTRAINT agency_service_settings_unique UNIQUE (agency_id, service_id);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

-- ================================================================
-- STEP 2: 既存テーブルへのカラム追加
-- ================================================================

-- 2-1. agency_tracking_linksにカラムを追加
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS service_id UUID;

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS agency_id UUID;

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS tracking_code VARCHAR(50);

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS line_friend_url TEXT;

ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS destination_url TEXT;

-- 2-2. tracking_codeにUNIQUE制約を追加
DO $$
BEGIN
    ALTER TABLE agency_tracking_links
    ADD CONSTRAINT agency_tracking_links_tracking_code_unique UNIQUE (tracking_code);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

-- 2-3. agency_conversionsにカラムを追加
ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS conversion_type VARCHAR(100);

ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS tracking_link_id UUID;

ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS agency_id UUID;

-- 2-4. agency_commissionsにカラムを追加
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS agency_id UUID;

ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS period_start TIMESTAMP WITH TIME ZONE;

ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS period_end TIMESTAMP WITH TIME ZONE;

ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

-- 2-5. agenciesテーブルにカラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS code VARCHAR(50);

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS own_commission_rate NUMERIC(5,2) DEFAULT 20.00;

-- 2-6. agency_usersテーブルにカラムを追加
ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS agency_id UUID;

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- 2-7. servicesテーブルにカラムを追加（既存テーブルの場合）
ALTER TABLE services
ADD COLUMN IF NOT EXISTS line_official_url TEXT;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS app_redirect_url TEXT;

-- ================================================================
-- STEP 3: 外部キー制約の追加
-- ================================================================

-- 3-1. agency_service_settingsの外部キー
DO $$
BEGIN
    ALTER TABLE agency_service_settings
    ADD CONSTRAINT fk_agency_service_settings_agency
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_service_settings
    ADD CONSTRAINT fk_agency_service_settings_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3-2. agency_tracking_linksの外部キー
DO $$
BEGIN
    ALTER TABLE agency_tracking_links
    ADD CONSTRAINT fk_agency_tracking_links_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_tracking_links
    ADD CONSTRAINT fk_agency_tracking_links_agency
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_tracking_links
    ADD CONSTRAINT fk_agency_tracking_links_created_by
    FOREIGN KEY (created_by) REFERENCES agency_users(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3-3. agency_conversionsの外部キー
DO $$
BEGIN
    ALTER TABLE agency_conversions
    ADD CONSTRAINT fk_agency_conversions_tracking_link
    FOREIGN KEY (tracking_link_id) REFERENCES agency_tracking_links(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_conversions
    ADD CONSTRAINT fk_agency_conversions_agency
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3-4. agency_commissionsの外部キー
DO $$
BEGIN
    ALTER TABLE agency_commissions
    ADD CONSTRAINT fk_agency_commissions_agency
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3-5. agency_usersの外部キー
DO $$
BEGIN
    ALTER TABLE agency_users
    ADD CONSTRAINT fk_agency_users_agency
    FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ================================================================
-- STEP 4: インデックスの作成
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);
CREATE INDEX IF NOT EXISTS idx_agency_service_settings_agency_id ON agency_service_settings(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_service_settings_service_id ON agency_service_settings(service_id);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_service_id ON agency_tracking_links(service_id);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_agency_id ON agency_tracking_links(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_tracking_code ON agency_tracking_links(tracking_code);
CREATE INDEX IF NOT EXISTS idx_agency_conversions_agency_id ON agency_conversions(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_conversions_tracking_link_id ON agency_conversions(tracking_link_id);
CREATE INDEX IF NOT EXISTS idx_agency_commissions_agency_id ON agency_commissions(agency_id);

-- ================================================================
-- STEP 5: 初期データの投入（報酬率: 全て粗利の20%）
-- ================================================================

-- 5-1. 既存のTaskMate AIとLiteWEB+を削除（冪等性確保）
DELETE FROM services WHERE name IN ('TaskMate AI', 'LiteWEB+');

-- 5-2. 新しいデータを挿入
INSERT INTO services (name, description, domain, line_official_url, app_redirect_url, default_commission_rate, default_referral_rate, subscription_price, status)
VALUES
    (
        'TaskMate AI',
        'LINE上でコード生成ができるAIアシスタント',
        'taskmateai.net',
        'https://line.me/R/ti/p/@taskmateai',  -- ⚠️ 実際のLINE URLに置き換えてください
        'https://liff.line.me/2006603169-QEmPo1ba',  -- ⚠️ 実際のLIFF URLに置き換えてください
        20.00,  -- 粗利の20%
        0.00,
        2980,
        'active'
    ),
    (
        'LiteWEB+',
        'ノーコードWebサイト作成サービス',
        'liteweb.plus',
        'https://line.me/R/ti/p/@litewebplus',  -- ⚠️ 実際のLINE URLに置き換えてください
        NULL,  -- LiteWEB+はLINEのみの場合
        20.00,  -- 粗利の20%
        0.00,
        4980,
        'active'
    );

-- ================================================================
-- STEP 6: セットアップ完了確認
-- ================================================================

SELECT
    '✅ セットアップ完了！' as status,
    COUNT(*) as service_count,
    STRING_AGG(name || ' (' || default_commission_rate || '%)', ', ') as services
FROM services
WHERE status = 'active';

-- ================================================================
-- 確認クエリ（セットアップ後に実行してください）
-- ================================================================
--
-- -- 全サービスを確認
-- SELECT
--     name as "サービス名",
--     default_commission_rate as "報酬率(%)",
--     subscription_price as "月額(円)",
--     status as "ステータス"
-- FROM services
-- ORDER BY name;
--
-- -- 期待される結果:
-- -- | サービス名   | 報酬率(%) | 月額(円) | ステータス |
-- -- |-------------|----------|---------|----------|
-- -- | TaskMate AI | 20.00    | 2980    | active   |
-- -- | LiteWEB+    | 20.00    | 4980    | active   |
--
-- ================================================================
