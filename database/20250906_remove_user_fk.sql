-- 外部キー制約を削除してLINEユーザーIDを直接使用可能にする
-- これによりusersテーブルへの依存を解消

-- generation_queueテーブルの外部キー制約を削除
ALTER TABLE generation_queue 
DROP CONSTRAINT IF EXISTS generation_queue_user_id_fkey;

-- user_idカラムの型をTEXTに変更（LINE User IDを格納）
ALTER TABLE generation_queue 
ALTER COLUMN user_id TYPE TEXT;

-- codes_generatedテーブルの外部キー制約を削除
ALTER TABLE codes_generated 
DROP CONSTRAINT IF EXISTS codes_generated_user_id_fkey;

ALTER TABLE codes_generated 
ALTER COLUMN user_id TYPE TEXT;

-- claude_usageテーブルの外部キー制約を削除  
ALTER TABLE claude_usage 
DROP CONSTRAINT IF EXISTS claude_usage_user_id_fkey;

ALTER TABLE claude_usage 
ALTER COLUMN user_id TYPE TEXT;

-- conversation_sessionsテーブルの外部キー制約を削除
ALTER TABLE conversation_sessions 
DROP CONSTRAINT IF EXISTS conversation_sessions_user_id_fkey;

ALTER TABLE conversation_sessions 
ALTER COLUMN user_id TYPE TEXT;

-- インデックスを追加してパフォーマンスを維持
CREATE INDEX IF NOT EXISTS idx_generation_queue_user_id ON generation_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_codes_generated_user_id ON codes_generated(user_id);
CREATE INDEX IF NOT EXISTS idx_claude_usage_user_id ON claude_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user_id ON conversation_sessions(user_id);

-- 処理日時のインデックスも追加
CREATE INDEX IF NOT EXISTS idx_generation_queue_created_at ON generation_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_codes_generated_created_at ON codes_generated(created_at);