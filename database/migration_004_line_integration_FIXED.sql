-- Migration 004: LINE Integration Support (FIXED VERSION)
-- 代理店登録フローにLINE連携を追加

-- 【重要】既存データの確認と修正を含む修正版

-- STEP 1: 既存のstatus値を確認（実行してログを確認）
SELECT DISTINCT status, COUNT(*)
FROM agencies
GROUP BY status;

-- STEP 2: 既存データを新しい制約に合わせる
-- 既存の 'active' はそのまま
-- 'pending' もそのまま
-- その他の値があれば 'active' に統一
UPDATE agencies
SET status = 'active'
WHERE status NOT IN ('pending', 'active', 'inactive', 'pending_line_verification');

-- STEP 3: agencies テーブルにLINE関連カラムを追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS line_user_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS line_display_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS line_picture_url TEXT,
ADD COLUMN IF NOT EXISTS registration_token VARCHAR(255);

-- STEP 4: インデックス追加
CREATE INDEX IF NOT EXISTS idx_agencies_line_user_id ON agencies(line_user_id);
CREATE INDEX IF NOT EXISTS idx_agencies_registration_token ON agencies(registration_token);

-- STEP 5: statusカラムに新しい状態を追加（既存のCHECK制約を更新）
DO $$
BEGIN
    -- 既存の制約を削除（存在する場合）
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agencies_status_check'
        AND conrelid = 'agencies'::regclass
    ) THEN
        ALTER TABLE agencies DROP CONSTRAINT agencies_status_check;
    END IF;

    -- 新しい制約を追加
    ALTER TABLE agencies
    ADD CONSTRAINT agencies_status_check
    CHECK (status IN ('pending', 'pending_line_verification', 'active', 'inactive'));
END $$;

-- STEP 6: コメント追加
COMMENT ON COLUMN agencies.line_user_id IS 'LINE User ID (LINE連携後に設定)';
COMMENT ON COLUMN agencies.line_display_name IS 'LINE表示名';
COMMENT ON COLUMN agencies.line_picture_url IS 'LINEプロフィール画像URL';
COMMENT ON COLUMN agencies.registration_token IS '登録完了用のワンタイムトークン（LINE連携前）';
COMMENT ON COLUMN agencies.status IS 'pending: 承認待ち, pending_line_verification: LINE連携待ち, active: アクティブ, inactive: 無効';
