-- ================================================================
-- 株式会社イケメン 代理店管理システム
-- サービステーブル セットアップスクリプト
-- ================================================================
--
-- 実行手順:
-- 1. https://supabase.com/dashboard にアクセス
-- 2. プロジェクト選択 → SQL Editor
-- 3. このファイルの内容をコピー&ペースト
-- 4. Run をクリック
--
-- ================================================================

-- 1. servicesテーブルの作成
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,  -- サービス名は一意
    description TEXT,
    domain VARCHAR(255),
    default_commission_rate NUMERIC(5,2) DEFAULT 20.00,  -- 基本統括報酬率: 粗利の20%
    default_referral_rate NUMERIC(5,2) DEFAULT 0.00,
    subscription_price NUMERIC(10,2),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. agency_service_settingsテーブルの作成
-- 代理店ごとにサービスの報酬率をカスタマイズ可能
CREATE TABLE IF NOT EXISTS agency_service_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    commission_rate NUMERIC(5,2),  -- カスタム報酬率（NULLの場合はデフォルト使用）
    referral_rate NUMERIC(5,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agency_id, service_id)
);

-- 3. agency_tracking_linksにservice_idカラムを追加
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;

-- 4. agency_tracking_linksにagency_idカラムを追加（存在しない場合）
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;

-- 5. agency_tracking_linksにtracking_codeカラムを追加（存在しない場合）
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS tracking_code VARCHAR(50) UNIQUE;

-- 6. agency_tracking_linksにnameカラムを追加（存在しない場合）
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- 7. agency_conversionsにconversion_typeカラムを追加（存在しない場合）
ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS conversion_type VARCHAR(100);

-- 8. agency_conversionsにtracking_link_idカラムを追加（存在しない場合）
ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS tracking_link_id UUID REFERENCES agency_tracking_links(id) ON DELETE SET NULL;

-- 9. agency_conversionsにagency_idカラムを追加（存在しない場合）
ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;

-- 10. agency_commissionsにagency_idカラムを追加（存在しない場合）
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;

-- 11. agency_commissionsにperiod_startとperiod_endカラムを追加（存在しない場合）
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS period_start TIMESTAMP WITH TIME ZONE;

ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS period_end TIMESTAMP WITH TIME ZONE;

-- 12. agency_commissionsにcommission_rateカラムを追加（存在しない場合）
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

-- 13. agenciesテーブルにカラムを追加（存在しない場合）
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE;

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

-- 14. agency_usersテーブルにカラムを追加（存在しない場合）
ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- 15. 初期データの挿入（報酬率: 全て粗利の20%）
INSERT INTO services (name, description, domain, default_commission_rate, default_referral_rate, subscription_price, status)
VALUES
    (
        'TaskMate AI',
        'LINE上でコード生成ができるAIアシスタント',
        'taskmateai.net',
        20.00,  -- 粗利の20%
        0.00,
        2980,
        'active'
    ),
    (
        'LiteWEB+',
        'ノーコードWebサイト作成サービス',
        'liteweb.plus',
        20.00,  -- 粗利の20%
        0.00,
        4980,
        'active'
    )
ON CONFLICT (name) DO UPDATE SET
    default_commission_rate = EXCLUDED.default_commission_rate,
    default_referral_rate = EXCLUDED.default_referral_rate,
    updated_at = NOW();

-- 16. インデックスの作成（パフォーマンス最適化）
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

-- 17. 確認クエリ
SELECT
    '✅ セットアップ完了！' as status,
    COUNT(*) as service_count,
    STRING_AGG(name || ' (' || default_commission_rate || '%)', ', ') as services
FROM services
WHERE status = 'active';

-- ================================================================
-- セットアップ完了後の確認
-- ================================================================
-- 以下のクエリを実行して、正しく設定されているか確認してください：
--
-- SELECT * FROM services;
-- SELECT * FROM agency_service_settings;
--
-- 期待される結果:
-- - TaskMate AI: 報酬率 20.00%
-- - LiteWEB+: 報酬率 20.00%
-- ================================================================
