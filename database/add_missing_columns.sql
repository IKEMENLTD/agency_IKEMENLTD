-- ===================================
-- 不足しているカラムを追加するSQL
-- ===================================

-- 1. agencies テーブルに不足カラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE NOT NULL,
ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL,
ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) NOT NULL;

-- 2. agency_users テーブルに不足カラムを追加
ALTER TABLE agency_users
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL UNIQUE,
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL,
ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL;

-- 3. agency_tracking_links テーブルに不足カラムを追加
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS created_by UUID NOT NULL REFERENCES agency_users(id),
ADD COLUMN IF NOT EXISTS tracking_code VARCHAR(20) UNIQUE NOT NULL,
ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL,
ADD COLUMN IF NOT EXISTS line_friend_url TEXT NOT NULL;

-- 4. agency_tracking_visits テーブルに不足カラムを追加
ALTER TABLE agency_tracking_visits
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS tracking_link_id UUID NOT NULL REFERENCES agency_tracking_links(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS agency_id UUID NOT NULL REFERENCES agencies(id);

-- 5. agency_conversions テーブルに不足カラムを追加
ALTER TABLE agency_conversions
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS tracking_link_id UUID NOT NULL REFERENCES agency_tracking_links(id),
ADD COLUMN IF NOT EXISTS agency_id UUID NOT NULL REFERENCES agencies(id),
ADD COLUMN IF NOT EXISTS conversion_type VARCHAR(50) NOT NULL;

-- 6. agency_commissions テーブルに不足カラムを追加
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS agency_id UUID NOT NULL REFERENCES agencies(id),
ADD COLUMN IF NOT EXISTS period_start DATE NOT NULL,
ADD COLUMN IF NOT EXISTS period_end DATE NOT NULL,
ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5, 2) NOT NULL;

-- 7. インデックス追加（既存の場合はスキップ）
CREATE INDEX IF NOT EXISTS idx_agencies_code ON agencies(code);
CREATE INDEX IF NOT EXISTS idx_agencies_status ON agencies(status);
CREATE INDEX IF NOT EXISTS idx_agency_users_agency_id ON agency_users(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_users_email ON agency_users(email);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_agency_id ON agency_tracking_links(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_tracking_code ON agency_tracking_links(tracking_code);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_visits_tracking_link_id ON agency_tracking_visits(tracking_link_id);
CREATE INDEX IF NOT EXISTS idx_agency_tracking_visits_agency_id ON agency_tracking_visits(agency_id);

-- 8. 既存のstatusカラムの制約を更新（存在する場合）
DO $$
BEGIN
    -- agencies テーブルのstatus制約を更新
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'agencies'
        AND column_name = 'status'
    ) THEN
        ALTER TABLE agencies
        DROP CONSTRAINT IF EXISTS agencies_status_check;

        ALTER TABLE agencies
        ADD CONSTRAINT agencies_status_check
        CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'inactive'));

        -- デフォルト値を設定
        ALTER TABLE agencies
        ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
END $$;

-- 9. 確認クエリ
SELECT
    'テーブル構造の確認' as message,
    table_name,
    COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN (
    'agencies',
    'agency_users',
    'agency_tracking_links',
    'agency_tracking_visits',
    'agency_conversions',
    'agency_commissions'
)
GROUP BY table_name
ORDER BY table_name;

-- 10. 主キーの確認
SELECT
    tc.table_name,
    kcu.column_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'PRIMARY KEY'
AND tc.table_name IN (
    'agencies',
    'agency_users',
    'agency_tracking_links',
    'agency_tracking_visits',
    'agency_conversions',
    'agency_commissions'
)
ORDER BY tc.table_name;