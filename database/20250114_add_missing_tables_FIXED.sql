-- ============================================
-- 既存テーブルに追加で必要なテーブルのみ作成（修正版）
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

-- 既存のconversation_sessionsテーブルの構造を確認して、カラムを追加
DO $$ 
BEGIN
  -- ready_for_code カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'ready_for_code') THEN
    ALTER TABLE conversation_sessions ADD COLUMN ready_for_code BOOLEAN DEFAULT FALSE;
  END IF;

  -- last_generated_code カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'last_generated_code') THEN
    ALTER TABLE conversation_sessions ADD COLUMN last_generated_code BOOLEAN DEFAULT FALSE;
  END IF;

  -- is_modifying カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'is_modifying') THEN
    ALTER TABLE conversation_sessions ADD COLUMN is_modifying BOOLEAN DEFAULT FALSE;
  END IF;

  -- waiting_for_screenshot カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'waiting_for_screenshot') THEN
    ALTER TABLE conversation_sessions ADD COLUMN waiting_for_screenshot BOOLEAN DEFAULT FALSE;
  END IF;

  -- image_content カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'image_content') THEN
    ALTER TABLE conversation_sessions ADD COLUMN image_content TEXT;
  END IF;

  -- error_screenshot カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'error_screenshot') THEN
    ALTER TABLE conversation_sessions ADD COLUMN error_screenshot TEXT;
  END IF;

  -- extracted_requirements カラムを追加
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'conversation_sessions' 
                 AND column_name = 'extracted_requirements') THEN
    ALTER TABLE conversation_sessions ADD COLUMN extracted_requirements JSONB DEFAULT '{}';
  END IF;
END $$;

-- インデックス作成（存在しない場合のみ）
CREATE INDEX IF NOT EXISTS idx_conversations_user_session ON conversations(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);

CREATE INDEX IF NOT EXISTS idx_checkpoints_user ON session_checkpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON session_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_active ON session_checkpoints(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_revisions_session ON code_revisions(session_id);
CREATE INDEX IF NOT EXISTS idx_revisions_user ON code_revisions(user_id);

-- RLSポリシー設定（サービスロールでのアクセスを許可）
-- 既存のポリシーを削除してから作成
DO $$ 
BEGIN
  -- conversations テーブル
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversations') THEN
    DROP POLICY IF EXISTS "Service role can access all conversations" ON conversations;
  END IF;
  
  ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Service role can access all conversations" ON conversations
    FOR ALL USING (true);

  -- session_checkpoints テーブル
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_checkpoints') THEN
    DROP POLICY IF EXISTS "Service role can access all checkpoints" ON session_checkpoints;
  END IF;
  
  ALTER TABLE session_checkpoints ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Service role can access all checkpoints" ON session_checkpoints
    FOR ALL USING (true);

  -- code_revisions テーブル
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'code_revisions') THEN
    DROP POLICY IF EXISTS "Service role can access all revisions" ON code_revisions;
  END IF;
  
  ALTER TABLE code_revisions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Service role can access all revisions" ON code_revisions
    FOR ALL USING (true);
END $$;

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
  
  -- 削除件数をログ出力
  RAISE NOTICE 'Cleanup completed. Deleted old conversations and checkpoints.';
END;
$$ LANGUAGE plpgsql;

-- 既存のconversation_sessionsと新しいconversationsテーブルを同期する関数
CREATE OR REPLACE FUNCTION sync_conversation_messages()
RETURNS TRIGGER AS $$
DECLARE
  msg_record RECORD;
  msg_index INTEGER := 0;
BEGIN
  -- messages が NULL または空配列の場合は何もしない
  IF NEW.messages IS NULL OR jsonb_array_length(NEW.messages) = 0 THEN
    RETURN NEW;
  END IF;

  -- session_id_text が NULL の場合はスキップ
  IF NEW.session_id_text IS NULL THEN
    RAISE WARNING 'session_id_text is NULL for user_id: %', NEW.user_id;
    RETURN NEW;
  END IF;

  -- 各メッセージを処理
  FOR msg_record IN 
    SELECT value AS msg, ordinality - 1 AS idx 
    FROM jsonb_array_elements(NEW.messages) WITH ORDINALITY
  LOOP
    INSERT INTO conversations (user_id, session_id, message_index, role, content, metadata)
    VALUES (
      NEW.user_id,
      NEW.session_id_text,
      msg_record.idx,
      COALESCE(msg_record.msg->>'role', 'user'),
      COALESCE(msg_record.msg->>'content', ''),
      COALESCE(msg_record.msg->'metadata', '{}')::jsonb
    )
    ON CONFLICT (session_id, message_index) 
    DO UPDATE SET 
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      updated_at = CURRENT_TIMESTAMP;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成（既存のトリガーがあれば削除してから作成）
DROP TRIGGER IF EXISTS sync_messages_trigger ON conversation_sessions;
CREATE TRIGGER sync_messages_trigger
AFTER INSERT OR UPDATE OF messages ON conversation_sessions
FOR EACH ROW
EXECUTE FUNCTION sync_conversation_messages();

-- データ移行：既存のconversation_sessionsからconversationsテーブルへ
-- 安全のため、エラーハンドリングを追加
DO $$
BEGIN
  -- 既存データの移行
  INSERT INTO conversations (user_id, session_id, message_index, role, content, metadata, created_at)
  SELECT 
    cs.user_id,
    cs.session_id_text,
    (row_number() OVER (PARTITION BY cs.session_id_text ORDER BY ordinality))::integer - 1 as message_index,
    COALESCE(msg->>'role', 'user') as role,
    COALESCE(msg->>'content', '') as content,
    COALESCE(msg->'metadata', '{}')::jsonb as metadata,
    cs.created_at
  FROM conversation_sessions cs
  CROSS JOIN LATERAL jsonb_array_elements(cs.messages) WITH ORDINALITY AS msg(msg, ordinality)
  WHERE cs.messages IS NOT NULL 
    AND jsonb_array_length(cs.messages) > 0
    AND cs.session_id_text IS NOT NULL
  ON CONFLICT (session_id, message_index) DO NOTHING;
  
  RAISE NOTICE 'Data migration completed successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Data migration encountered an error: %', SQLERRM;
END $$;

-- 統計ビュー作成（既存のビューがあれば置き換え）
CREATE OR REPLACE VIEW conversation_stats AS
SELECT 
  user_id,
  COUNT(DISTINCT session_id) as total_sessions,
  COUNT(*) as total_messages,
  MAX(created_at) as last_activity,
  MIN(created_at) as first_activity,
  AVG(LENGTH(content)) as avg_message_length
FROM conversations
GROUP BY user_id;

-- ヘルパー関数：最新のセッションIDを取得
CREATE OR REPLACE FUNCTION get_latest_session_id(p_user_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_session_id TEXT;
BEGIN
  SELECT session_id_text INTO v_session_id
  FROM conversation_sessions
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- 成功メッセージ
DO $$ 
BEGIN 
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Tables created: conversations, session_checkpoints, code_revisions';
  RAISE NOTICE 'Existing conversation_sessions table enhanced with new columns';
  RAISE NOTICE 'Triggers and functions created for data synchronization';
  RAISE NOTICE '==============================================';
END $$;