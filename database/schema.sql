-- 営業代理店管理システム データベーススキーマ
-- TaskMate AI 流入経路測定システム拡張

-- 1. 代理店マスターテーブル
CREATE TABLE IF NOT EXISTS agencies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL, -- 代理店コード（URL用）
    name VARCHAR(255) NOT NULL, -- 代理店名
    company_name VARCHAR(255), -- 会社名
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50),
    address TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'inactive', 'rejected')),
    commission_rate DECIMAL(5, 2) DEFAULT 10.00, -- 手数料率（%）
    payment_info JSONB, -- 振込先情報等
    settings JSONB DEFAULT '{}', -- カスタム設定
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 代理店ユーザーテーブル
CREATE TABLE IF NOT EXISTS agency_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 代理店用トラッキングリンクテーブル
CREATE TABLE IF NOT EXISTS agency_tracking_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES agency_users(id),
    tracking_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_term VARCHAR(255),
    utm_content VARCHAR(255),
    line_friend_url TEXT NOT NULL,
    destination_url TEXT, -- カスタムリダイレクト先
    is_active BOOLEAN DEFAULT true,
    visit_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 代理店経由の訪問記録テーブル
CREATE TABLE IF NOT EXISTS agency_tracking_visits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tracking_link_id UUID NOT NULL REFERENCES agency_tracking_links(id) ON DELETE CASCADE,
    agency_id UUID NOT NULL REFERENCES agencies(id),
    visitor_ip VARCHAR(50),
    user_agent TEXT,
    referrer TEXT,
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    country VARCHAR(100),
    region VARCHAR(100),
    city VARCHAR(100),
    session_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. コンバージョン記録テーブル
CREATE TABLE IF NOT EXISTS agency_conversions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tracking_link_id UUID NOT NULL REFERENCES agency_tracking_links(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    visit_id UUID REFERENCES agency_tracking_visits(id),
    user_id UUID REFERENCES users(id), -- 既存のusersテーブルと連携
    conversion_type VARCHAR(50) NOT NULL, -- 'line_friend', 'purchase', 'signup' など
    conversion_value DECIMAL(10, 2),
    line_user_id VARCHAR(255), -- LINE ユーザーID
    line_display_name VARCHAR(255),
    line_picture_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. 手数料管理テーブル
CREATE TABLE IF NOT EXISTS agency_commissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_id UUID NOT NULL REFERENCES agencies(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_conversions INTEGER DEFAULT 0,
    total_sales DECIMAL(12, 2) DEFAULT 0,
    commission_rate DECIMAL(5, 2) NOT NULL,
    commission_amount DECIMAL(12, 2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
    payment_date DATE,
    payment_method VARCHAR(100),
    payment_reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agency_id, period_start, period_end)
);

-- インデックス作成
CREATE INDEX idx_agencies_code ON agencies(code);
CREATE INDEX idx_agencies_status ON agencies(status);
CREATE INDEX idx_agency_users_agency_id ON agency_users(agency_id);
CREATE INDEX idx_agency_users_email ON agency_users(email);
CREATE INDEX idx_agency_tracking_links_agency_id ON agency_tracking_links(agency_id);
CREATE INDEX idx_agency_tracking_links_tracking_code ON agency_tracking_links(tracking_code);
CREATE INDEX idx_agency_tracking_visits_tracking_link_id ON agency_tracking_visits(tracking_link_id);
CREATE INDEX idx_agency_tracking_visits_agency_id ON agency_tracking_visits(agency_id);
CREATE INDEX idx_agency_tracking_visits_created_at ON agency_tracking_visits(created_at);
CREATE INDEX idx_agency_conversions_agency_id ON agency_conversions(agency_id);
CREATE INDEX idx_agency_conversions_tracking_link_id ON agency_conversions(tracking_link_id);
CREATE INDEX idx_agency_commissions_agency_id ON agency_commissions(agency_id);
CREATE INDEX idx_agency_commissions_period ON agency_commissions(period_start, period_end);

-- Row Level Security (RLS) ポリシー
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_tracking_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_commissions ENABLE ROW LEVEL SECURITY;

-- 代理店は自分のデータのみアクセス可能
CREATE POLICY "Agencies can view own data" ON agencies
    FOR SELECT USING (id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agency users can view own agency" ON agency_users
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agency can manage own tracking links" ON agency_tracking_links
    FOR ALL USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agency can view own visits" ON agency_tracking_visits
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agency can view own conversions" ON agency_conversions
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

CREATE POLICY "Agency can view own commissions" ON agency_commissions
    FOR SELECT USING (agency_id = auth.jwt() ->> 'agency_id'::uuid);

-- トリガー関数：更新日時の自動更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー設定
CREATE TRIGGER update_agencies_updated_at
    BEFORE UPDATE ON agencies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_agency_users_updated_at
    BEFORE UPDATE ON agency_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_agency_tracking_links_updated_at
    BEFORE UPDATE ON agency_tracking_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_agency_commissions_updated_at
    BEFORE UPDATE ON agency_commissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- サンプルデータ（開発用）
-- INSERT INTO agencies (code, name, company_name, contact_email, commission_rate)
-- VALUES
-- ('agency001', 'サンプル代理店', '株式会社サンプル', 'sample@agency.com', 15.00),
-- ('agency002', 'テスト代理店', '株式会社テスト', 'test@agency.com', 10.00);