-- マイグレーション: 4段階代理店制度（リファラルシステム）
-- 作成日: 2025-10-18
-- 説明: 既存のagenciesテーブルに階層構造とコミッション率を追加

-- ===================================
-- STEP 0: トリガー関数の作成（存在しない場合）
-- ===================================

-- updated_at 自動更新関数を作成
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at IS 'updated_atカラムを自動更新するトリガー関数';

-- ===================================
-- STEP 1: agenciesテーブルの拡張
-- ===================================

-- 親代理店IDカラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS parent_agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;

-- 代理店階層レベルを追加（1〜4）
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1
CHECK (level >= 1 AND level <= 4);

-- 自己報酬率を追加（デフォルト20%）
-- 既存のcommission_rateカラムは別の用途で使用されているため、新しいカラム名を使用
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS own_commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 20.00
CHECK (own_commission_rate >= 0 AND own_commission_rate <= 100);

-- コメント追加
COMMENT ON COLUMN agencies.parent_agency_id IS '親代理店のID（1次代理店の場合はNULL）';
COMMENT ON COLUMN agencies.level IS '代理店階層レベル: 1=1次, 2=2次, 3=3次, 4=4次';
COMMENT ON COLUMN agencies.own_commission_rate IS '案件成約時の自己報酬率（パーセンテージ）';
COMMENT ON COLUMN agencies.commission_rate IS '基本手数料率（旧システム用、将来的に廃止予定）';

-- ===================================
-- STEP 2: インデックス追加
-- ===================================

-- 親代理店IDのインデックス（階層トラバーサル用）
CREATE INDEX IF NOT EXISTS idx_agencies_parent_agency_id
ON agencies(parent_agency_id);

-- 階層レベルのインデックス（レベル別検索用）
CREATE INDEX IF NOT EXISTS idx_agencies_level
ON agencies(level);

-- ===================================
-- STEP 3: 報酬分配記録テーブルの作成
-- ===================================

CREATE TABLE IF NOT EXISTS agency_commission_distributions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- コンバージョンID（どの成約に対する報酬か）
    conversion_id UUID NOT NULL REFERENCES agency_conversions(id) ON DELETE CASCADE,

    -- 報酬を受け取る代理店ID
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,

    -- 成約代理店ID（誰が成約したか）
    closing_agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,

    -- 案件総額
    deal_amount DECIMAL(12, 2) NOT NULL,

    -- 報酬タイプ: 'own' = 自己報酬, 'referral' = リファラルコミッション
    commission_type VARCHAR(50) NOT NULL CHECK (commission_type IN ('own', 'referral')),

    -- 適用された報酬率（パーセンテージ）
    commission_rate DECIMAL(5, 2) NOT NULL,

    -- 報酬金額
    commission_amount DECIMAL(12, 2) NOT NULL,

    -- 受取代理店の階層レベル（記録時点）
    agency_level INTEGER NOT NULL CHECK (agency_level >= 1 AND agency_level <= 4),

    -- 支払いステータス
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'paid', 'cancelled')),

    -- 支払日
    paid_at TIMESTAMP WITH TIME ZONE,

    -- メタデータ（追加情報用）
    metadata JSONB DEFAULT '{}',

    -- タイムスタンプ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- コメント追加
COMMENT ON TABLE agency_commission_distributions IS '代理店コミッション分配記録テーブル';
COMMENT ON COLUMN agency_commission_distributions.commission_type IS 'own=自己報酬, referral=リファラルコミッション';
COMMENT ON COLUMN agency_commission_distributions.payment_status IS 'pending=未払い, approved=承認済, paid=支払済, cancelled=キャンセル';

-- ===================================
-- STEP 4: インデックス追加（分配テーブル）
-- ===================================

CREATE INDEX IF NOT EXISTS idx_commission_distributions_conversion_id
ON agency_commission_distributions(conversion_id);

CREATE INDEX IF NOT EXISTS idx_commission_distributions_agency_id
ON agency_commission_distributions(agency_id);

CREATE INDEX IF NOT EXISTS idx_commission_distributions_closing_agency_id
ON agency_commission_distributions(closing_agency_id);

CREATE INDEX IF NOT EXISTS idx_commission_distributions_created_at
ON agency_commission_distributions(created_at);

CREATE INDEX IF NOT EXISTS idx_commission_distributions_payment_status
ON agency_commission_distributions(payment_status);

-- ===================================
-- STEP 5: トリガー関数（更新日時自動更新）
-- ===================================

-- トリガーを作成（既存の場合は削除してから作成）
DROP TRIGGER IF EXISTS update_commission_distributions_updated_at ON agency_commission_distributions;

CREATE TRIGGER update_commission_distributions_updated_at
    BEFORE UPDATE ON agency_commission_distributions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================
-- STEP 6: Row Level Security (RLS)
-- ===================================

ALTER TABLE agency_commission_distributions ENABLE ROW LEVEL SECURITY;

-- 既存のポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Agencies can view own commission distributions" ON agency_commission_distributions;

-- 代理店は自分の報酬記録のみ閲覧可能
CREATE POLICY "Agencies can view own commission distributions"
ON agency_commission_distributions
    FOR SELECT
    USING (
        agency_id IN (
            SELECT id FROM agencies
            WHERE id = (auth.jwt() ->> 'agency_id')::uuid
        )
    );

-- ===================================
-- STEP 7: 既存データの更新
-- ===================================

-- 既存の代理店を全て1次代理店として設定（levelカラムが追加されたばかりの場合）
UPDATE agencies
SET
    level = 1,
    own_commission_rate = 20.00,
    parent_agency_id = NULL
WHERE level = 1 AND own_commission_rate = 20.00 AND parent_agency_id IS NULL;
-- WHERE条件を追加して、既に設定済みのデータを上書きしないようにする

-- ===================================
-- STEP 8: ヘルパー関数: 代理店階層取得
-- ===================================

-- 指定された代理店から1次代理店までの階層チェーンを取得
CREATE OR REPLACE FUNCTION get_agency_hierarchy(start_agency_id UUID)
RETURNS TABLE (
    agency_id UUID,
    level INTEGER,
    own_commission_rate DECIMAL(5, 2),
    parent_agency_id UUID
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE agency_chain AS (
        -- 基点となる代理店
        SELECT
            a.id AS agency_id,
            a.level,
            a.own_commission_rate,
            a.parent_agency_id
        FROM agencies a
        WHERE a.id = start_agency_id

        UNION ALL

        -- 親代理店を再帰的に取得
        SELECT
            a.id AS agency_id,
            a.level,
            a.own_commission_rate,
            a.parent_agency_id
        FROM agencies a
        INNER JOIN agency_chain ac ON a.id = ac.parent_agency_id
        WHERE a.parent_agency_id IS NOT NULL OR a.level = 1
    )
    SELECT * FROM agency_chain ORDER BY level ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_agency_hierarchy IS '指定された代理店から1次代理店までの階層チェーンを取得';

-- ===================================
-- STEP 9: ヘルパー関数: 報酬率取得
-- ===================================

-- 階層レベルに基づいて標準報酬率を取得
CREATE OR REPLACE FUNCTION get_standard_commission_rate(agency_level INTEGER)
RETURNS DECIMAL(5, 2) AS $$
BEGIN
    RETURN CASE
        WHEN agency_level = 1 THEN 20.00
        WHEN agency_level = 2 THEN 18.00
        WHEN agency_level = 3 THEN 16.00
        WHEN agency_level = 4 THEN 14.00
        ELSE 20.00  -- デフォルト
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_standard_commission_rate IS '階層レベルに基づいて標準報酬率を返す';

-- ===================================
-- マイグレーション完了
-- ===================================

-- マイグレーション記録テーブルの作成（存在しない場合）
CREATE TABLE IF NOT EXISTS migration_history (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- マイグレーション記録
INSERT INTO migration_history (version, description, applied_at)
VALUES ('002', '4段階代理店制度（リファラルシステム）', NOW())
ON CONFLICT (version) DO NOTHING;

-- 完了メッセージ
DO $$
BEGIN
    RAISE NOTICE '✅ マイグレーション 002 完了: 4段階代理店制度（リファラルシステム）';
END $$;
