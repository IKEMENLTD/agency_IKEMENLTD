-- Migration 005: Registration Token Timeout
-- 登録トークンに有効期限を追加（セキュリティ強化）

-- STEP 1: agencies テーブルに有効期限カラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS registration_token_expires_at TIMESTAMP;

-- STEP 2: インデックス追加（有効期限切れトークンのクエリを高速化）
CREATE INDEX IF NOT EXISTS idx_agencies_registration_token_expires_at
ON agencies(registration_token_expires_at)
WHERE registration_token IS NOT NULL;

-- STEP 3: 既存の未完了登録レコードに有効期限を設定（15分後）
UPDATE agencies
SET registration_token_expires_at = created_at + INTERVAL '15 minutes'
WHERE registration_token IS NOT NULL
  AND registration_token_expires_at IS NULL
  AND status = 'pending_line_verification';

-- STEP 4: 期限切れトークンを自動クリーンアップする関数
CREATE OR REPLACE FUNCTION cleanup_expired_registration_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- 期限切れトークンをクリア
    UPDATE agencies
    SET registration_token = NULL,
        registration_token_expires_at = NULL
    WHERE registration_token IS NOT NULL
      AND registration_token_expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- STEP 5: コメント追加
COMMENT ON COLUMN agencies.registration_token_expires_at IS '登録トークンの有効期限（15分）';
COMMENT ON FUNCTION cleanup_expired_registration_tokens() IS '期限切れ登録トークンを自動クリーンアップ';

-- STEP 6: クリーンアップ関数を手動実行（初回）
SELECT cleanup_expired_registration_tokens() AS cleaned_tokens;

-- 注意: 自動クリーンアップのスケジューリングはSupabaseのcron機能を使用
-- Supabase Dashboard > Database > Cron Jobs で設定:
--
-- SELECT cron.schedule(
--   'cleanup-expired-tokens',
--   '*/15 * * * *',  -- 15分ごと
--   $$SELECT cleanup_expired_registration_tokens();$$
-- );
