-- ============================================
-- 既存テーブルに追加で必要なテーブルのみ作成
-- ============================================

-- 1. 会話メッセージ履歴テーブル（新規作成）
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, message_index)
);

-- 2. セッションチェックポイントテーブル（新規作成）
CREATE TABLE IF NOT EXISTS session_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  checkpoint_type VARCHAR(50) NOT NULL,
  context_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  restored_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE
);

-- 3. コード修正履歴テーブル（新規作成）
CREATE TABLE IF NOT EXISTS code_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  code_content TEXT NOT NULL,
  requirements JSONB,
  modification_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  parent_revision_id UUID REFERENCES code_revisions(id),
  UNIQUE(session_id, revision_number)
);

-- 既存のconversation_sessionsテーブルに不足カラムを追加
ALTER TABLE conversation_sessions 
ADD COLUMN IF NOT EXISTS ready_for_code BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_generated_code BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_modifying BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS waiting_for_screenshot BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS image_content TEXT,
ADD COLUMN IF NOT EXISTS error_screenshot TEXT,
ADD COLUMN IF NOT EXISTS extracted_requirements JSONB DEFAULT '{}';

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_conversations_user_session ON conversations(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);

CREATE INDEX IF NOT EXISTS idx_checkpoints_user ON session_checkpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON session_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_active ON session_checkpoints(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_revisions_session ON code_revisions(session_id);
CREATE INDEX IF NOT EXISTS idx_revisions_user ON code_revisions(user_id);

-- RLSポリシー設定（必要に応じて）
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_revisions ENABLE ROW LEVEL SECURITY;

-- 基本的なRLSポリシー（サービスロールは全アクセス可能）
CREATE POLICY "Service role can access all conversations" ON conversations
  FOR ALL USING (true);

CREATE POLICY "Service role can access all checkpoints" ON session_checkpoints
  FOR ALL USING (true);

CREATE POLICY "Service role can access all revisions" ON code_revisions
  FOR ALL USING (true);

-- 古いデータのクリーンアップ関数
CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS void AS $$
BEGIN
  -- 30日以上前の会話を削除
  DELETE FROM conversations 
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
  
  -- 非アクティブなチェックポイントで7日以上前のものを削除
  DELETE FROM session_checkpoints 
  WHERE is_active = FALSE 
  AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- 既存のconversation_sessionsと新しいconversationsテーブルを同期する関数
CREATE OR REPLACE FUNCTION sync_conversation_messages()
RETURNS TRIGGER AS $$
BEGIN
  -- conversation_sessionsのmessages JSONBから個別レコードを作成
  IF NEW.messages IS NOT NULL AND jsonb_array_length(NEW.messages) > 0 THEN
    INSERT INTO conversations (user_id, session_id, message_index, role, content, metadata)
    SELECT 
      NEW.user_id,
      NEW.session_id_text,
      (row_number() OVER ())::integer - 1 as message_index,
      COALESCE(msg->>'role', 'user') as role,
      COALESCE(msg->>'content', '') as content,
      COALESCE(msg->'metadata', '{}')::jsonb as metadata
    FROM jsonb_array_elements(NEW.messages) msg
    ON CONFLICT (session_id, message_index) 
    DO UPDATE SET 
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      updated_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成
DROP TRIGGER IF EXISTS sync_messages_trigger ON conversation_sessions;
CREATE TRIGGER sync_messages_trigger
AFTER INSERT OR UPDATE OF messages ON conversation_sessions
FOR EACH ROW
EXECUTE FUNCTION sync_conversation_messages();

-- データ移行：既存のconversation_sessionsからconversationsテーブルへ
INSERT INTO conversations (user_id, session_id, message_index, role, content, metadata, created_at)
SELECT 
  cs.user_id,
  cs.session_id_text,
  (row_number() OVER (PARTITION BY cs.session_id_text ORDER BY msg_index))::integer - 1 as message_index,
  COALESCE(msg->>'role', 'user') as role,
  COALESCE(msg->>'content', '') as content,
  COALESCE(msg->'metadata', '{}')::jsonb as metadata,
  cs.created_at
FROM conversation_sessions cs
CROSS JOIN LATERAL jsonb_array_elements(cs.messages) WITH ORDINALITY AS msg(msg, msg_index)
WHERE cs.messages IS NOT NULL 
  AND jsonb_array_length(cs.messages) > 0
ON CONFLICT (session_id, message_index) DO NOTHING;

-- 統計ビュー作成
CREATE OR REPLACE VIEW conversation_stats AS
SELECT 
  user_id,
  COUNT(DISTINCT session_id) as total_sessions,
  COUNT(*) as total_messages,
  MAX(created_at) as last_activity,
  MIN(created_at) as first_activity
FROM conversations
GROUP BY user_id;

-- 成功メッセージ
DO $$ 
BEGIN 
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Tables created/updated: conversations, session_checkpoints, code_revisions';
  RAISE NOTICE 'Existing conversation_sessions enhanced with new columns';
END $$;