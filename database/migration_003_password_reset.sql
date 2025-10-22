-- マイグレーション: パスワードリセット機能
-- 作成日: 2025-10-18
-- 説明: パスワードリセット用のトークンテーブルを作成

-- ===================================
-- STEP 1: password_reset_tokens テーブルの作成
-- ===================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- ユーザーID
    agency_user_id UUID NOT NULL REFERENCES agency_users(id) ON DELETE CASCADE,

    -- SHA256ハッシュ化されたトークン
    token VARCHAR(255) NOT NULL UNIQUE,

    -- トークンの有効期限
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 使用済みフラグ
    used BOOLEAN DEFAULT FALSE,

    -- 使用日時
    used_at TIMESTAMP WITH TIME ZONE,

    -- 開発用: リセットURL（本番では不要）
    reset_url TEXT,

    -- 開発用: 平文トークン（本番では削除推奨）
    plain_token TEXT,

    -- タイムスタンプ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- コメント追加
COMMENT ON TABLE password_reset_tokens IS 'パスワードリセット用トークンテーブル';
COMMENT ON COLUMN password_reset_tokens.token IS 'SHA256ハッシュ化されたトークン';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'トークンの有効期限（デフォルト1時間）';
COMMENT ON COLUMN password_reset_tokens.used IS 'トークンが使用済みかどうか';
COMMENT ON COLUMN password_reset_tokens.plain_token IS '開発用：平文トークン（本番では削除）';

-- ===================================
-- STEP 2: インデックス追加
-- ===================================

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_agency_user_id
ON password_reset_tokens(agency_user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
ON password_reset_tokens(token);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_used
ON password_reset_tokens(used);

-- ===================================
-- STEP 3: Row Level Security (RLS)
-- ===================================

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- 既存のポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Users can view own reset tokens" ON password_reset_tokens;

-- ユーザーは自分のリセットトークンのみ閲覧可能（管理用）
CREATE POLICY "Users can view own reset tokens"
ON password_reset_tokens
    FOR SELECT
    USING (
        agency_user_id IN (
            SELECT id FROM agency_users
            WHERE id = (auth.jwt() ->> 'userId')::uuid
        )
    );

-- ===================================
-- STEP 4: 自動クリーンアップ関数
-- ===================================

-- 期限切れトークンを自動削除する関数
CREATE OR REPLACE FUNCTION cleanup_expired_reset_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- 7日以上前の使用済みトークンを削除
    DELETE FROM password_reset_tokens
    WHERE used = true
    AND created_at < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- 期限切れの未使用トークンも削除
    DELETE FROM password_reset_tokens
    WHERE used = false
    AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_reset_tokens IS '期限切れのパスワードリセットトークンを削除（7日以上前の使用済み + 期限切れ未使用）';

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
VALUES ('003', 'パスワードリセット機能', NOW())
ON CONFLICT (version) DO NOTHING;

-- 完了メッセージ
DO $$
BEGIN
    RAISE NOTICE '✅ マイグレーション 003 完了: パスワードリセット機能';
END $$;
