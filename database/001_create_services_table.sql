-- マルチサービス対応: servicesテーブル作成
-- 作成日: 2025-10-22
-- 対象: 代理店管理システム（マルチサービス対応）

-- ===================================
-- 1. servicesテーブル（サービスマスター）
-- ===================================

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 基本情報
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),

  -- ドメイン・URL設定
  domain TEXT UNIQUE NOT NULL,
  tracking_base_url TEXT NOT NULL,           -- 例: https://taskmateai.net/t
  app_redirect_url TEXT NOT NULL,            -- 例: https://taskmateai.net/app
  line_add_redirect_url TEXT,                -- LINE友達追加後のリダイレクト先

  -- LINE設定
  line_channel_id TEXT UNIQUE NOT NULL,
  line_channel_secret TEXT NOT NULL,
  line_channel_access_token TEXT NOT NULL,
  line_official_url TEXT NOT NULL,           -- 例: https://lin.ee/xxx

  -- 報酬設定（デフォルト値）
  default_commission_rate DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  default_referral_rate DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  subscription_price INTEGER NOT NULL DEFAULT 10000,  -- 月額料金（円）

  -- メタデータ
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_domain ON services(domain);

-- ===================================
-- 2. agency_service_settings（代理店×サービス設定）
-- ===================================

CREATE TABLE IF NOT EXISTS agency_service_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 関連
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,

  -- カスタム報酬率（NULL の場合は services.default_* を使用）
  commission_rate DECIMAL(5,2),              -- 例: 25.00 (25%)
  referral_rate DECIMAL(5,2),                -- 例: 3.00 (3%)

  -- 状態
  is_active BOOLEAN DEFAULT true,

  -- メモ
  notes TEXT,

  -- メタデータ
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(agency_id, service_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_agency_service_settings_agency ON agency_service_settings(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_service_settings_service ON agency_service_settings(service_id);
CREATE INDEX IF NOT EXISTS idx_agency_service_settings_active ON agency_service_settings(is_active);

-- ===================================
-- 3. line_profile_services（LINEユーザー×サービス関連）
-- ===================================

CREATE TABLE IF NOT EXISTS line_profile_services (
  line_user_id TEXT NOT NULL REFERENCES line_profiles(user_id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,

  is_friend BOOLEAN DEFAULT true,
  added_at TIMESTAMP DEFAULT NOW(),
  unfollowed_at TIMESTAMP,

  PRIMARY KEY (line_user_id, service_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_line_profile_services_service ON line_profile_services(service_id);
CREATE INDEX IF NOT EXISTS idx_line_profile_services_is_friend ON line_profile_services(is_friend);

-- ===================================
-- 4. 既存テーブルへのカラム追加
-- ===================================

-- agency_tracking_links
ALTER TABLE agency_tracking_links ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_agency_tracking_links_service ON agency_tracking_links(service_id);

-- agency_tracking_visits
ALTER TABLE agency_tracking_visits ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_agency_tracking_visits_service ON agency_tracking_visits(service_id);

-- agency_conversions
ALTER TABLE agency_conversions ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_agency_conversions_service ON agency_conversions(service_id);

-- agency_commissions
ALTER TABLE agency_commissions ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_agency_commissions_service ON agency_commissions(service_id);

-- 完了
SELECT 'マルチサービス対応スキーマの作成が完了しました。' AS status;
