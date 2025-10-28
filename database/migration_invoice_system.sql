-- ========================================
-- 請求書自動発行機能 マイグレーション
-- バージョン: 2.0
-- 作成日: 2025-10-28
-- 対応: インボイス制度・源泉徴収税完全対応
-- ========================================
--
-- 実行手順:
-- 1. Supabase Dashboard → SQL Editor を開く
-- 2. このファイルの内容をコピー&ペースト
-- 3. Run をクリック
--
-- ========================================

BEGIN;

-- ========================================
-- 1. 既存テーブルの拡張: agencies
-- ========================================

-- インボイス制度・源泉徴収税対応カラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'corporation'
    CHECK (entity_type IN ('corporation', 'individual')),
ADD COLUMN IF NOT EXISTS invoice_registration_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS is_qualified_invoice_issuer BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tax_calculation_type VARCHAR(20) DEFAULT 'standard'
    CHECK (tax_calculation_type IN ('standard', 'exempt', 'simplified'));

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_agencies_entity_type ON agencies(entity_type);
CREATE INDEX IF NOT EXISTS idx_agencies_is_qualified_invoice_issuer ON agencies(is_qualified_invoice_issuer);

-- 既存データへのデフォルト値設定
UPDATE agencies
SET entity_type = 'corporation',
    is_qualified_invoice_issuer = false,
    tax_calculation_type = 'standard'
WHERE entity_type IS NULL;

-- ========================================
-- 2. 新規テーブル: invoices（請求書マスター）
-- ========================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 請求書識別情報
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_date DATE NOT NULL,
    payment_due_date DATE NOT NULL,

    -- 代理店情報（スナップショット）
    agency_id UUID NOT NULL REFERENCES agencies(id),
    agency_name VARCHAR(255) NOT NULL,
    agency_code VARCHAR(50) NOT NULL,
    agency_entity_type VARCHAR(20) NOT NULL,
    agency_invoice_registration_number VARCHAR(20),
    agency_address TEXT,
    agency_contact_email VARCHAR(255),
    agency_contact_phone VARCHAR(50),
    agency_payment_info JSONB,

    -- 対象期間
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- 金額情報
    subtotal DECIMAL(12,2) NOT NULL,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    tax_amount DECIMAL(12,2) NOT NULL,
    withholding_tax_rate DECIMAL(5,2) DEFAULT 0,
    withholding_tax_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,

    -- インボイス制度対応
    is_qualified_invoice BOOLEAN DEFAULT false,
    invoice_note TEXT,

    -- ステータス
    status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'cancelled', 'corrected')),

    -- 訂正・取消
    parent_invoice_id UUID REFERENCES invoices(id),
    correction_reason TEXT,
    is_correction BOOLEAN DEFAULT false,

    -- メール送信情報
    email_sent_at TIMESTAMP,
    email_recipient VARCHAR(255),
    email_status VARCHAR(50),
    email_error TEXT,

    -- PDF情報
    pdf_url TEXT,
    pdf_generated_at TIMESTAMP,

    -- 保存期間（電子帳簿保存法）
    retention_until DATE,
    archived_at TIMESTAMP,

    -- メタデータ
    notes TEXT,
    metadata JSONB DEFAULT '{}',

    -- タイムスタンプ
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- 制約
    CONSTRAINT unique_agency_period UNIQUE (agency_id, period_start, period_end)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_invoices_agency_id ON invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_retention_until ON invoices(retention_until);

-- ========================================
-- 3. 新規テーブル: invoice_items（請求明細）
-- ========================================

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 請求書との紐付け
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    -- サービス情報
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service_name VARCHAR(255) NOT NULL,

    -- コミッション情報
    commission_id UUID REFERENCES agency_commissions(id) ON DELETE SET NULL,

    -- 明細情報
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    conversion_count INTEGER,
    total_sales DECIMAL(12,2),
    commission_rate DECIMAL(5,2),
    unit_price DECIMAL(12,2) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,

    -- 並び順
    sort_order INTEGER DEFAULT 0,

    -- タイムスタンプ
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_service_id ON invoice_items(service_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_commission_id ON invoice_items(commission_id);

-- ========================================
-- 4. 新規テーブル: invoice_sequence（請求書番号採番）
-- ========================================

CREATE TABLE IF NOT EXISTS invoice_sequence (
    year_month VARCHAR(6) PRIMARY KEY,
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 5. 関数: get_next_invoice_number（請求書番号自動採番）
-- ========================================

CREATE OR REPLACE FUNCTION get_next_invoice_number(target_year_month VARCHAR(6))
RETURNS VARCHAR(50) AS $$
DECLARE
    next_num INTEGER;
    invoice_num VARCHAR(50);
BEGIN
    -- 行ロック（FOR UPDATE）で排他制御
    SELECT last_number INTO next_num
    FROM invoice_sequence
    WHERE year_month = target_year_month
    FOR UPDATE;

    IF NOT FOUND THEN
        -- 新規作成
        INSERT INTO invoice_sequence (year_month, last_number)
        VALUES (target_year_month, 1)
        RETURNING last_number INTO next_num;
    ELSE
        -- インクリメント
        UPDATE invoice_sequence
        SET last_number = last_number + 1,
            updated_at = NOW()
        WHERE year_month = target_year_month
        RETURNING last_number INTO next_num;
    END IF;

    -- 請求書番号生成: INV-YYYYMM-XXXXX
    invoice_num := 'INV-' || target_year_month || '-' || LPAD(next_num::TEXT, 5, '0');

    RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 6. トリガー関数: set_invoice_retention（保存期限自動設定）
-- ========================================

CREATE OR REPLACE FUNCTION set_invoice_retention()
RETURNS TRIGGER AS $$
BEGIN
    NEW.retention_until := NEW.invoice_date + INTERVAL '7 years';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成
DROP TRIGGER IF EXISTS set_invoice_retention_trigger ON invoices;
CREATE TRIGGER set_invoice_retention_trigger
BEFORE INSERT ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_invoice_retention();

-- ========================================
-- 7. トリガー関数: update_updated_at（更新日時自動更新）
-- ========================================

-- 既存の関数を確認して、なければ作成
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
        CREATE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
    END IF;
END
$$;

-- invoices テーブルのトリガー
DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- invoice_items テーブルのトリガー
DROP TRIGGER IF EXISTS update_invoice_items_updated_at ON invoice_items;
CREATE TRIGGER update_invoice_items_updated_at
BEFORE UPDATE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 8. 既存テーブルの拡張: agency_commissions
-- ========================================

-- 請求書IDカラムを追加
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_agency_commissions_invoice_id ON agency_commissions(invoice_id);

-- ========================================
-- 9. Row Level Security (RLS) ポリシー
-- ========================================

-- RLS を有効化
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- 既存のポリシーを削除（冪等性のため）
DROP POLICY IF EXISTS "Agencies can view own invoices" ON invoices;
DROP POLICY IF EXISTS "Agencies can view own invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Service role can access all invoices" ON invoices;
DROP POLICY IF EXISTS "Service role can access all invoice items" ON invoice_items;

-- ポリシー: 代理店は自分のデータのみ閲覧可能
CREATE POLICY "Agencies can view own invoices"
ON invoices FOR SELECT
USING (agency_id = current_setting('app.current_agency_id', true)::uuid);

-- ポリシー: 代理店は自分の請求書明細のみ閲覧可能
CREATE POLICY "Agencies can view own invoice items"
ON invoice_items FOR SELECT
USING (
    invoice_id IN (
        SELECT id FROM invoices
        WHERE agency_id = current_setting('app.current_agency_id', true)::uuid
    )
);

-- サービスロールキーは全てのデータにアクセス可能
CREATE POLICY "Service role can access all invoices"
ON invoices FOR ALL
USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

CREATE POLICY "Service role can access all invoice items"
ON invoice_items FOR ALL
USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

COMMIT;

-- ========================================
-- マイグレーション完了
-- ========================================

-- 確認クエリ
SELECT 'マイグレーション完了！以下のテーブルが作成されました:' as status;

SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
    AND table_name IN ('invoices', 'invoice_items', 'invoice_sequence')
ORDER BY table_name;

-- agencies テーブルの新しいカラムを確認
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'agencies'
    AND column_name IN ('entity_type', 'invoice_registration_number', 'is_qualified_invoice_issuer', 'tax_calculation_type')
ORDER BY column_name;

-- 請求書番号採番関数のテスト
SELECT
    'テスト: 請求書番号採番' as test_name,
    get_next_invoice_number('202510') as invoice_number_1,
    get_next_invoice_number('202510') as invoice_number_2,
    get_next_invoice_number('202511') as invoice_number_3;

-- 期待される結果:
-- invoice_number_1: INV-202510-00001
-- invoice_number_2: INV-202510-00002
-- invoice_number_3: INV-202511-00001
