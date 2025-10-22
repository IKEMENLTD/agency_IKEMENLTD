-- 1. usersテーブルの修正
ALTER TABLE users
ADD COLUMN IF NOT EXISTS line_user_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS payment_start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_reset_month INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_preference TEXT DEFAULT 'detailed';

-- display_nameからline_user_idへデータ移行
UPDATE users
SET line_user_id = display_name
WHERE line_user_id IS NULL AND display_name IS NOT NULL;

-- 2. データ型の統一（job_idとsession_id）
-- 新しいUUID列を追加
ALTER TABLE generation_queue
ADD COLUMN IF NOT EXISTS job_uuid UUID DEFAULT gen_random_uuid();

ALTER TABLE conversation_sessions
ADD COLUMN IF NOT EXISTS session_uuid UUID DEFAULT gen_random_uuid();

-- 3. タイムスタンプの統一（全てtimestamp with time zoneに）
ALTER TABLE claude_usage
ALTER COLUMN created_at TYPE timestamp with time zone
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE code_shares
ALTER COLUMN created_at TYPE timestamp with time zone
USING created_at AT TIME ZONE 'UTC';

-- 4. インデックスの追加（パフォーマンス改善）
CREATE INDEX IF NOT EXISTS idx_users_line_user_id
ON users(line_user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user_status
ON conversation_sessions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_codes_user_created
ON generated_codes(user_id, created_at DESC);

-- 5. 要件抽出の履歴テーブル（新規）
CREATE TABLE IF NOT EXISTS requirement_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_messages JSONB NOT NULL,
  extracted_requirements JSONB NOT NULL,
  confidence_level INTEGER DEFAULT 0,
  extraction_method TEXT DEFAULT 'ai',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. コード品質チェック結果（新規）
CREATE TABLE IF NOT EXISTS code_quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID REFERENCES code_shares(id),
  check_type TEXT NOT NULL, -- 'security', 'performance', 'requirements'
  issues JSONB DEFAULT '[]',
  score INTEGER DEFAULT 0,
  checked_by TEXT DEFAULT 'claude-sonnet-4',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. ユーザー統計ビュー
CREATE OR REPLACE VIEW user_generation_stats AS
SELECT
  u.line_user_id,
  u.subscription_status,
  u.monthly_usage_count,
  COUNT(DISTINCT gc.id) as total_codes_generated,
  COUNT(DISTINCT cs.id) as total_shares_created,
  AVG(cu.total_tokens) as avg_tokens_per_request,
  MAX(gc.created_at) as last_generation_date
FROM users u
LEFT JOIN generated_codes gc ON u.line_user_id = gc.user_id
LEFT JOIN code_shares cs ON u.line_user_id = cs.user_id
LEFT JOIN claude_usage cu ON u.line_user_id = cu.user_id
GROUP BY u.line_user_id, u.subscription_status, u.monthly_usage_count;

-- 8. アクティブセッションビュー
CREATE OR REPLACE VIEW active_sessions AS
SELECT
  cs.session_id,
  cs.user_id,
  cs.status,
  cs.created_at,
  cs.messages,
  COUNT(gc.id) as codes_in_session,
  MAX(gc.created_at) as last_code_generated
FROM conversation_sessions cs
LEFT JOIN generated_codes gc ON cs.session_id = gc.session_id
WHERE cs.status IN ('active', 'waiting', 'processing')
GROUP BY cs.session_id, cs.user_id, cs.status, cs.created_at, cs.messages;

-- コメント追加
COMMENT ON TABLE requirement_extractions IS 'AI要件抽出の履歴と精度追跡';
COMMENT ON TABLE code_quality_checks IS 'AIによるコード品質チェック結果';
COMMENT ON COLUMN users.line_user_id IS 'LINEユーザーID（主要識別子）';
COMMENT ON COLUMN users.ai_preference IS 'AI応答スタイル設定（detailed/concise/technical）';