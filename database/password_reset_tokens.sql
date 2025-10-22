-- ===================================
-- パスワードリセット用テーブル
-- ===================================

-- パスワードリセットトークンテーブル
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_user_id UUID NOT NULL REFERENCES agency_users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE
);

-- インデックス
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_agency_user_id ON password_reset_tokens(agency_user_id);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- 古いトークンを自動削除する関数
CREATE OR REPLACE FUNCTION delete_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW() OR used = true;
END;
$$ LANGUAGE plpgsql;

-- コメント
COMMENT ON TABLE password_reset_tokens IS 'パスワードリセット用一時トークン';
COMMENT ON COLUMN password_reset_tokens.token IS 'リセット用トークン（URLに含まれる）';
COMMENT ON COLUMN password_reset_tokens.expires_at IS '有効期限（デフォルト1時間）';
COMMENT ON COLUMN password_reset_tokens.used IS '使用済みフラグ';