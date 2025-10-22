-- 既存テーブルの構造に合わせて必要なカラムを追加/修正

-- usersテーブルの更新（既存のカラムは変更せず、不足分を追加）
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS line_user_id TEXT UNIQUE;

-- line_user_idをNOT NULLにする（データがある場合は注意）
-- UPDATE users SET line_user_id = 'temp_' || id::text WHERE line_user_id IS NULL;
-- ALTER TABLE users ALTER COLUMN line_user_id SET NOT NULL;

-- conversation_sessionsテーブルの更新
ALTER TABLE conversation_sessions
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- IDをプライマリキーにする（もしまだなら）
-- ALTER TABLE conversation_sessions ADD PRIMARY KEY (id);

-- processing_queueテーブルの更新
ALTER TABLE processing_queue
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS line_user_id TEXT,
ADD COLUMN IF NOT EXISTS requirements JSONB DEFAULT '{}';

-- generated_codesテーブルの更新
ALTER TABLE generated_codes
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS requirements_summary TEXT,
ADD COLUMN IF NOT EXISTS generated_code TEXT,
ADD COLUMN IF NOT EXISTS explanation TEXT,
ADD COLUMN IF NOT EXISTS usage_steps TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS code_category TEXT,
ADD COLUMN IF NOT EXISTS claude_prompt TEXT;

-- claude_usage_logsテーブルの更新（既存のclaude_usageと統合）
ALTER TABLE claude_usage_logs
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS request_type TEXT DEFAULT 'code_generation',
ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(10, 4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT true;

-- system_metricsテーブルの更新（既存のmetricsと統合）
ALTER TABLE system_metrics
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS metric_type TEXT,
ADD COLUMN IF NOT EXISTS metric_value DECIMAL(20, 4);

-- インデックスの作成（IF NOT EXISTSで既存チェック）
CREATE INDEX IF NOT EXISTS idx_users_line_user_id ON users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user_id ON conversation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_status ON conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_user_id ON processing_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_codes_user_id ON generated_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_codes_session_id ON generated_codes(session_id);
CREATE INDEX IF NOT EXISTS idx_claude_usage_logs_user_id ON claude_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_metrics_metric_type ON system_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_system_metrics_recorded_at ON system_metrics(recorded_at);

-- 更新日時を自動更新するトリガー（既に存在する場合は作成しない）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成（既に存在する場合はスキップ）
DO $$
BEGIN
  -- usersテーブルのトリガー
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_users_updated_at'
  ) THEN
    CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- conversation_sessionsテーブルのトリガー
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_conversation_sessions_updated_at'
  ) THEN
    CREATE TRIGGER update_conversation_sessions_updated_at 
    BEFORE UPDATE ON conversation_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;