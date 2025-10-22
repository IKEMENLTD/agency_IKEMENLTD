-- 緊急修正: generated_codesテーブルの作成とUUID問題の解決

-- 1. generated_codesテーブルがなければ作成
CREATE TABLE IF NOT EXISTS generated_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,  -- TEXT型（LINEユーザーID）
  session_id TEXT,         -- TEXT型（セッションID）
  queue_id TEXT,          
  code TEXT NOT NULL,
  gas_url TEXT,
  category TEXT,
  subcategory TEXT,
  requirements JSONB,
  quality_score INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 既存テーブルがある場合はカラム型を修正
DO $$ 
BEGIN
  -- user_idをTEXTに変更
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generated_codes' 
    AND column_name = 'user_id' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE generated_codes 
    ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
  END IF;
  
  -- session_idをTEXTに変更
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generated_codes' 
    AND column_name = 'session_id' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE generated_codes 
    ALTER COLUMN session_id TYPE TEXT USING session_id::TEXT;
  END IF;
END $$;

-- 3. インデックス作成（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_generated_codes_user_id ON generated_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_codes_created_at ON generated_codes(created_at);

-- 4. vision_usageテーブルの修正（既出だが念のため）
ALTER TABLE vision_usage 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

ALTER TABLE vision_usage 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- 5. usersテーブルのline_user_idもTEXT型に（念のため）
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'line_user_id' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE users 
    ALTER COLUMN line_user_id TYPE TEXT USING line_user_id::TEXT;
  END IF;
END $$;

-- 6. generation_queueテーブルのuser_idもTEXT型に
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generation_queue' 
    AND column_name = 'user_id' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE generation_queue 
    ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
  END IF;
END $$;

-- 7. conversation_sessionsテーブルのuser_idもTEXT型に
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversation_sessions' 
    AND column_name = 'user_id' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE conversation_sessions 
    ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
  END IF;
END $$;

-- 確認クエリ
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'generated_codes', 'generation_queue', 'conversation_sessions', 'vision_usage')
AND column_name IN ('user_id', 'line_user_id', 'session_id')
ORDER BY table_name, column_name;