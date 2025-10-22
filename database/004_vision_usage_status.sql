-- vision_usageテーブルにstatus列とupdated_at列を追加（レースコンディション対策）

-- status列を追加（processing, completed, failed）
ALTER TABLE vision_usage 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- updated_at列を追加
ALTER TABLE vision_usage 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- statusにインデックスを追加（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_vision_usage_status 
ON vision_usage(status);

-- user_idとcreated_atの複合インデックス（日次集計の高速化）
CREATE INDEX IF NOT EXISTS idx_vision_usage_user_date 
ON vision_usage(user_id, created_at);

-- 既存データをcompletedに更新
UPDATE vision_usage 
SET status = 'completed' 
WHERE status IS NULL;

-- コメント追加
COMMENT ON COLUMN vision_usage.status IS 'レコードの状態: processing（処理中）, completed（完了）, failed（失敗）';
COMMENT ON COLUMN vision_usage.updated_at IS '最終更新日時（処理完了時に更新）';