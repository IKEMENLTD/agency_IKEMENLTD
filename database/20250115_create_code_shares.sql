-- コード共有機能のためのテーブル作成
-- 生成されたGASコードを外部URLで共有するための機能

-- ========================================
-- 1. code_shares テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS code_shares (
  -- 基本情報
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id VARCHAR(8) UNIQUE NOT NULL, -- 短縮URL用ID (例: Xa7Bf9Kp)
  version INTEGER DEFAULT 1, -- バージョン管理

  -- 関連情報
  user_id TEXT NOT NULL, -- LINE User ID
  job_id TEXT, -- processing_queueテーブルとの関連（IDがTEXT型のため）
  session_id TEXT, -- conversation_sessionsとの関連（session_id_textカラムを参照）
  parent_id UUID REFERENCES code_shares(id) ON DELETE SET NULL, -- 修正版の親

  -- コード情報
  title TEXT NOT NULL, -- 例: "スプレッドシート自動集計"
  description TEXT, -- AIが生成した説明
  code_content TEXT NOT NULL, -- 実際のGASコード
  language VARCHAR(20) DEFAULT 'javascript', -- 言語タイプ
  file_name TEXT DEFAULT 'code.gs', -- ファイル名

  -- アクセス設定
  is_public BOOLEAN DEFAULT true, -- 公開設定
  password_hash TEXT, -- パスワード保護（オプショナル）
  max_views INTEGER, -- 閲覧回数制限（NULLは無制限）

  -- メタデータ
  metadata JSONB DEFAULT '{}', -- 拡張用（カスタム設定など）
  tags TEXT[], -- タグ機能（例: ['spreadsheet', 'automation']）
  conversation_context JSONB, -- 生成時の会話コンテキスト
  requirements JSONB, -- 抽出された要件

  -- 統計情報
  view_count INTEGER DEFAULT 0, -- 閲覧回数
  copy_count INTEGER DEFAULT 0, -- コピー回数
  last_viewed_at TIMESTAMP, -- 最終閲覧日時

  -- フラグ
  is_premium BOOLEAN DEFAULT false, -- プレミアムユーザーのコードか
  is_deleted BOOLEAN DEFAULT false, -- 論理削除フラグ
  deletion_reason TEXT, -- 削除理由

  -- タイムスタンプ
  expires_at TIMESTAMP NOT NULL, -- 有効期限
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 2. code_share_access_logs テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS code_share_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID REFERENCES code_shares(id) ON DELETE CASCADE,

  -- アクセス情報
  ip_address INET, -- IPアドレス
  user_agent TEXT, -- User-Agentヘッダー
  referer TEXT, -- リファラー
  access_type VARCHAR(20), -- 'view', 'copy', 'download'

  -- デバイス情報
  device_type VARCHAR(20), -- 'mobile', 'desktop', 'tablet'
  browser VARCHAR(50), -- ブラウザ名
  os VARCHAR(50), -- OS名

  -- タイムスタンプ
  accessed_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 3. conversation_code_relations テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS conversation_code_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT, -- conversation_sessionsとの関連（session_id_textを参照）
  share_id UUID REFERENCES code_shares(id) ON DELETE CASCADE,

  -- 関連性情報
  relation_type VARCHAR(50), -- 'original', 'modified', 'reference'
  context_snapshot JSONB, -- 生成時の会話コンテキストのスナップショット

  -- タイムスタンプ
  created_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 4. user_code_history テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS user_code_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  share_id UUID REFERENCES code_shares(id) ON DELETE CASCADE,

  -- アクション情報
  action VARCHAR(50) NOT NULL, -- 'generated', 'modified', 'viewed', 'copied', 'deleted'
  action_details JSONB, -- アクションの詳細情報

  -- タイムスタンプ
  performed_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- インデックスの作成
-- ========================================

-- code_shares インデックス
CREATE INDEX IF NOT EXISTS idx_code_shares_short_id ON code_shares(short_id);
CREATE INDEX IF NOT EXISTS idx_code_shares_user_id ON code_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_code_shares_job_id ON code_shares(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_code_shares_session_id ON code_shares(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_code_shares_parent_id ON code_shares(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_code_shares_expires_at ON code_shares(expires_at) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_code_shares_created_at ON code_shares(created_at);
CREATE INDEX IF NOT EXISTS idx_code_shares_is_deleted ON code_shares(is_deleted);

-- code_share_access_logs インデックス
CREATE INDEX IF NOT EXISTS idx_access_logs_share_id ON code_share_access_logs(share_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_accessed_at ON code_share_access_logs(accessed_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_access_type ON code_share_access_logs(access_type);

-- conversation_code_relations インデックス
CREATE INDEX IF NOT EXISTS idx_conv_code_rel_user_id ON conversation_code_relations(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_code_rel_session_id ON conversation_code_relations(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_code_rel_share_id ON conversation_code_relations(share_id);

-- user_code_history インデックス
CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_code_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_share_id ON user_code_history(share_id);
CREATE INDEX IF NOT EXISTS idx_user_history_action ON user_code_history(action);
CREATE INDEX IF NOT EXISTS idx_user_history_performed_at ON user_code_history(performed_at DESC);

-- ========================================
-- Row Level Security (RLS)
-- ========================================

-- RLSを有効化
ALTER TABLE code_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_share_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_code_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_code_history ENABLE ROW LEVEL SECURITY;

-- code_shares ポリシー
-- 誰でも公開コードを閲覧可能
CREATE POLICY "Public code shares are viewable by everyone" ON code_shares
  FOR SELECT USING (is_public = true AND NOT is_deleted);

-- ユーザーは自分のコードを管理可能
CREATE POLICY "Users can manage their own code shares" ON code_shares
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::TEXT);

-- code_share_access_logs ポリシー
-- アクセスログは誰でも挿入可能（統計用）
CREATE POLICY "Anyone can insert access logs" ON code_share_access_logs
  FOR INSERT WITH CHECK (true);

-- conversation_code_relations ポリシー
-- ユーザーは自分の関連データを管理可能
CREATE POLICY "Users can manage their own relations" ON conversation_code_relations
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::TEXT);

-- user_code_history ポリシー
-- ユーザーは自分の履歴を閲覧可能
CREATE POLICY "Users can view their own history" ON user_code_history
  FOR SELECT USING (user_id = current_setting('app.current_user_id', true)::TEXT);

-- システムは履歴を挿入可能
CREATE POLICY "System can insert history" ON user_code_history
  FOR INSERT WITH CHECK (true);

-- ========================================
-- トリガー関数
-- ========================================

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION update_code_shares_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_code_shares_updated_at_trigger
  BEFORE UPDATE ON code_shares
  FOR EACH ROW
  EXECUTE FUNCTION update_code_shares_updated_at();

-- 有効期限切れコードの自動削除（クリーンアップ）
CREATE OR REPLACE FUNCTION cleanup_expired_code_shares()
RETURNS void AS $$
BEGIN
  -- 有効期限から7日経過した非プレミアムコードを物理削除
  DELETE FROM code_shares
  WHERE expires_at < NOW() - INTERVAL '7 days'
    AND is_premium = false
    AND is_deleted = true;

  -- 有効期限切れコードを論理削除
  UPDATE code_shares
  SET is_deleted = true,
      deletion_reason = 'expired'
  WHERE expires_at < NOW()
    AND is_deleted = false;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- ヘルパー関数
-- ========================================

-- 短縮IDの重複チェック関数
CREATE OR REPLACE FUNCTION check_short_id_exists(p_short_id VARCHAR(8))
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM code_shares WHERE short_id = p_short_id);
END;
$$ LANGUAGE plpgsql;

-- 閲覧回数をインクリメントする関数
CREATE OR REPLACE FUNCTION increment_view_count(p_short_id VARCHAR(8))
RETURNS void AS $$
BEGIN
  UPDATE code_shares
  SET view_count = view_count + 1,
      last_viewed_at = NOW()
  WHERE short_id = p_short_id;
END;
$$ LANGUAGE plpgsql;

-- コピー回数をインクリメントする関数
CREATE OR REPLACE FUNCTION increment_copy_count(p_short_id VARCHAR(8))
RETURNS void AS $$
BEGIN
  UPDATE code_shares
  SET copy_count = copy_count + 1
  WHERE short_id = p_short_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 初期データ・設定
-- ========================================

-- コメント追加
COMMENT ON TABLE code_shares IS 'Generated GAS codes shared via external URLs';
COMMENT ON COLUMN code_shares.short_id IS 'Unique 8-character ID for short URLs';
COMMENT ON COLUMN code_shares.expires_at IS 'Expiration date: 7 days for free users, 30 days for premium';
COMMENT ON COLUMN code_shares.conversation_context IS 'Conversation context at the time of code generation';