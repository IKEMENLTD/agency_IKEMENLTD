-- ========================================
-- Migration 006: 補助金ナビゲーターサービス追加
-- ========================================
-- 作成日: 2025-10-29
-- 説明: 補助金ナビゲーターサービスを追加し、複数サービス対応を強化

-- ========================================
-- Step 0: services テーブルに code カラムを追加
-- ========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'services'
        AND column_name = 'code'
    ) THEN
        ALTER TABLE services
        ADD COLUMN code VARCHAR(50) UNIQUE;

        -- インデックス追加
        CREATE INDEX idx_services_code ON services(code);

        RAISE NOTICE 'code カラムを services テーブルに追加しました';
    ELSE
        RAISE NOTICE 'code カラムは既に存在します';
    END IF;
END $$;

-- ========================================
-- Step 1: 補助金ナビゲーターサービスを追加
-- ========================================

INSERT INTO services (
    id,
    code,
    name,
    description,
    line_official_url,
    default_commission_rate,
    default_referral_rate,
    subscription_price,
    status,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'SUBSIDY_NAV',
    '補助金ナビゲーター',
    '補助金申請をサポートする専門サービス。最適な補助金の提案から申請書類の作成まで、トータルでサポートします。',
    'https://lin.ee/fbyGDxB',
    20.00,  -- デフォルト報酬率: 粗利益の20%
    10.00,  -- デフォルト紹介料率: 10%
    0.00,   -- 月額料金は案件ごとに変動（管理画面で入力）
    'active',
    NOW(),
    NOW()
) ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    line_official_url = EXCLUDED.line_official_url,
    default_commission_rate = EXCLUDED.default_commission_rate,
    updated_at = NOW();

-- ========================================
-- Step 2: agency_commissions テーブルに service_id を追加
-- ========================================

-- service_id カラムがまだ存在しない場合のみ追加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agency_commissions'
        AND column_name = 'service_id'
    ) THEN
        ALTER TABLE agency_commissions
        ADD COLUMN service_id UUID REFERENCES services(id);

        -- インデックス追加
        CREATE INDEX idx_agency_commissions_service_id ON agency_commissions(service_id);

        RAISE NOTICE 'service_id カラムを agency_commissions テーブルに追加しました';
    ELSE
        RAISE NOTICE 'service_id カラムは既に存在します';
    END IF;
END $$;

-- ========================================
-- Step 3: gross_profit カラムを追加（粗利益管理用）
-- ========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agency_commissions'
        AND column_name = 'gross_profit'
    ) THEN
        ALTER TABLE agency_commissions
        ADD COLUMN gross_profit DECIMAL(12, 2) DEFAULT 0;

        COMMENT ON COLUMN agency_commissions.gross_profit IS '粗利益（補助金サービス用）';

        RAISE NOTICE 'gross_profit カラムを agency_commissions テーブルに追加しました';
    ELSE
        RAISE NOTICE 'gross_profit カラムは既に存在します';
    END IF;
END $$;

-- ========================================
-- Step 4: 既存データのデフォルトサービス設定（TaskMate AI）
-- ========================================

-- TaskMate AI サービスが存在するか確認し、存在する場合はcodeを設定、存在しない場合は作成
DO $$
DECLARE
    existing_service_id UUID;
BEGIN
    -- 既存のTaskMate AIサービスを検索
    SELECT id INTO existing_service_id
    FROM services
    WHERE name LIKE '%TaskMate%' OR name LIKE '%taskmate%'
    LIMIT 1;

    IF existing_service_id IS NOT NULL THEN
        -- 既存サービスにcodeを設定
        UPDATE services
        SET code = 'TASKMATE_AI',
            default_commission_rate = COALESCE(default_commission_rate, 20.00),
            default_referral_rate = COALESCE(default_referral_rate, 10.00),
            updated_at = NOW()
        WHERE id = existing_service_id;

        RAISE NOTICE 'TaskMate AIサービスにcodeを設定しました: %', existing_service_id;
    ELSE
        -- 新規作成
        INSERT INTO services (
            code,
            name,
            description,
            line_official_url,
            default_commission_rate,
            default_referral_rate,
            subscription_price,
            status,
            created_at,
            updated_at
        ) VALUES (
            'TASKMATE_AI',
            'TaskMate AI',
            'GASコード自動生成AIサービス。LINE上で会話するだけで、業務自動化コードを生成します。',
            'https://lin.ee/XXXXXXX',
            20.00,
            10.00,
            9800.00,
            'active',
            NOW(),
            NOW()
        );

        RAISE NOTICE 'TaskMate AIサービスを新規作成しました';
    END IF;
END $$;

-- 既存のコミッションデータにTaskMate AIサービスIDを設定
UPDATE agency_commissions
SET service_id = (SELECT id FROM services WHERE code = 'TASKMATE_AI' LIMIT 1)
WHERE service_id IS NULL;

-- ========================================
-- Step 5: ユニーク制約を更新（サービスIDを含める）
-- ========================================

-- 既存のユニーク制約を削除
ALTER TABLE agency_commissions
DROP CONSTRAINT IF EXISTS agency_commissions_agency_id_period_start_period_end_key;

-- 新しいユニーク制約を追加（サービスID含む）
ALTER TABLE agency_commissions
ADD CONSTRAINT agency_commissions_agency_service_period_key
UNIQUE (agency_id, service_id, period_start, period_end);

-- ========================================
-- Step 6: 承認ステータス用のコメント追加
-- ========================================

COMMENT ON COLUMN agency_commissions.status IS
'コミッションステータス: pending (保留), approved (承認済み), paid (支払済み), rejected (否認), cancelled (キャンセル)';

-- ========================================
-- Step 7: 確認クエリ
-- ========================================

-- サービス一覧を確認
SELECT
    id,
    code,
    name,
    default_commission_rate,
    line_official_url,
    status
FROM services
ORDER BY created_at;

-- マイグレーション完了
SELECT 'Migration 006 completed successfully!' AS status;
