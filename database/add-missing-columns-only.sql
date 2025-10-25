-- ================================================================
-- 不足カラムのみ追加（最小限のSQL）
-- ================================================================
--
-- 既存のservicesテーブルに不足しているカラムだけを追加します
--
-- ================================================================

-- servicesテーブルに不足カラムを追加
ALTER TABLE services
ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE services
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

ALTER TABLE services
ADD COLUMN IF NOT EXISTS line_official_url TEXT;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS app_redirect_url TEXT;

-- nameカラムにUNIQUE制約を追加
DO $$
BEGIN
    ALTER TABLE services ADD CONSTRAINT services_name_unique UNIQUE (name);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- agency_tracking_linksに不足カラムを追加
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

-- tracking_codeにUNIQUE制約
DO $$
BEGIN
    ALTER TABLE agency_tracking_links
    ADD CONSTRAINT agency_tracking_links_tracking_code_unique UNIQUE (tracking_code);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 外部キー制約
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

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_tracking_code ON agency_tracking_links(tracking_code);

-- ================================================================
-- 既存データがある場合の確認
-- ================================================================

-- servicesテーブルのデータ確認
SELECT
    '✅ 既存サービス数' as status,
    COUNT(*) as count
FROM services;

-- TaskMate AI と LiteWEB+ が存在するか確認
SELECT
    name,
    default_commission_rate,
    subscription_price,
    line_official_url
FROM services
WHERE name IN ('TaskMate AI', 'LiteWEB+');

-- 存在しない場合は、以下のINSERTを実行してください:
--
-- DELETE FROM services WHERE name IN ('TaskMate AI', 'LiteWEB+');
--
-- INSERT INTO services (name, description, domain, line_official_url, app_redirect_url, default_commission_rate, default_referral_rate, subscription_price, status)
-- VALUES
--     (
--         'TaskMate AI',
--         'LINE上でコード生成ができるAIアシスタント',
--         'taskmateai.net',
--         'https://line.me/R/ti/p/@taskmateai',
--         'https://liff.line.me/2006603169-QEmPo1ba',
--         20.00,
--         0.00,
--         2980,
--         'active'
--     ),
--     (
--         'LiteWEB+',
--         'ノーコードWebサイト作成サービス',
--         'liteweb.plus',
--         'https://line.me/R/ti/p/@litewebplus',
--         NULL,
--         20.00,
--         0.00,
--         4980,
--         'active'
--     );
