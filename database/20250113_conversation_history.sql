-- ============================================
-- 会話履歴管理のための完全なスキーマ
-- ============================================

-- 既存テーブルの削除（必要に応じて）
DROP TABLE IF EXISTS conversation_contexts CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS session_checkpoints CASCADE;
DROP TABLE IF EXISTS code_revisions CASCADE;

-- ============================================
-- 1. 会話メッセージテーブル
-- ============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  message_index INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, message_index)
);

-- ============================================
-- 2. 会話コンテキストテーブル
-- ============================================
CREATE TABLE conversation_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL UNIQUE,
  session_id VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  subcategory VARCHAR(100),
  requirements JSONB NOT NULL DEFAULT '{}',
  extracted_requirements JSONB DEFAULT '{}',
  ready_for_code BOOLEAN DEFAULT FALSE,
  last_generated_code BOOLEAN DEFAULT FALSE,
  last_generated_category VARCHAR(100),
  last_generated_requirements JSONB,
  is_modifying BOOLEAN DEFAULT FALSE,
  is_adding_description BOOLEAN DEFAULT FALSE,
  waiting_for_screenshot BOOLEAN DEFAULT FALSE,
  waiting_for_confirmation BOOLEAN DEFAULT FALSE,
  image_content TEXT,
  error_screenshot TEXT,
  current_step INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

-- ============================================
-- 3. セッションチェックポイントテーブル
-- ============================================
CREATE TABLE session_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  context_snapshot JSONB NOT NULL,
  checkpoint_type VARCHAR(50) DEFAULT 'auto',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 4. コードリビジョンテーブル
-- ============================================
CREATE TABLE code_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  code TEXT NOT NULL,
  requirements JSONB NOT NULL,
  prompt TEXT,
  parent_revision_id UUID REFERENCES code_revisions(id),
  revision_number INTEGER NOT NULL DEFAULT 1,
  change_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- インデックス作成
-- ============================================

-- conversations テーブル
CREATE INDEX idx_conversations_user_session ON conversations(user_id, session_id);
CREATE INDEX idx_conversations_session_index ON conversations(session_id, message_index);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX idx_conversations_user_created ON conversations(user_id, created_at DESC);

-- conversation_contexts テーブル
CREATE INDEX idx_contexts_user ON conversation_contexts(user_id);
CREATE INDEX idx_contexts_session ON conversation_contexts(session_id);
CREATE INDEX idx_contexts_expires ON conversation_contexts(expires_at);
CREATE INDEX idx_contexts_updated ON conversation_contexts(updated_at DESC);

-- session_checkpoints テーブル
CREATE INDEX idx_checkpoints_user_session ON session_checkpoints(user_id, session_id);
CREATE INDEX idx_checkpoints_created ON session_checkpoints(created_at DESC);

-- code_revisions テーブル
CREATE INDEX idx_revisions_user_session ON code_revisions(user_id, session_id);
CREATE INDEX idx_revisions_parent ON code_revisions(parent_revision_id);
CREATE INDEX idx_revisions_created ON code_revisions(created_at DESC);

-- ============================================
-- RLS (Row Level Security) ポリシー
-- ============================================

-- conversations テーブル
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all conversations" ON conversations
  FOR ALL USING (auth.role() = 'service_role');

-- conversation_contexts テーブル
ALTER TABLE conversation_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all contexts" ON conversation_contexts
  FOR ALL USING (auth.role() = 'service_role');

-- session_checkpoints テーブル
ALTER TABLE session_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all checkpoints" ON session_checkpoints
  FOR ALL USING (auth.role() = 'service_role');

-- code_revisions テーブル
ALTER TABLE code_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all revisions" ON code_revisions
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- トリガー関数
-- ============================================

-- updated_at を自動更新
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー設定
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contexts_updated_at BEFORE UPDATE ON conversation_contexts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- クリーンアップ関数
-- ============================================

-- 期限切れセッションを削除
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  -- 期限切れコンテキストを削除
  DELETE FROM conversation_contexts 
  WHERE expires_at < CURRENT_TIMESTAMP;
  
  -- 関連する会話も削除
  DELETE FROM conversations 
  WHERE session_id NOT IN (
    SELECT session_id FROM conversation_contexts
  );
  
  -- 古いチェックポイントを削除（7日以上前）
  DELETE FROM session_checkpoints 
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- 定期実行用のコメント（Supabaseのcronジョブで設定）
-- SELECT cron.schedule('cleanup-sessions', '0 */6 * * *', 'SELECT cleanup_expired_sessions();');