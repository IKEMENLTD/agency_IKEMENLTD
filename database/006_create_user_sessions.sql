-- user_sessions テーブルを作成（セッション永続化用）
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- インデックスを作成
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 期限切れセッションを自動削除する関数
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions 
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- コメント
COMMENT ON TABLE user_sessions IS 'LINEユーザーの会話セッションを永続化';
COMMENT ON COLUMN user_sessions.user_id IS 'LINE User ID';
COMMENT ON COLUMN user_sessions.session_data IS '会話コンテキスト全体（JSON形式）';
COMMENT ON COLUMN user_sessions.expires_at IS 'セッション有効期限';