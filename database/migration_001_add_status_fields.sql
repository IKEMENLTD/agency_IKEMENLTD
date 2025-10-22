-- ===================================
-- マイグレーション: ステータスフィールド追加
-- ===================================

-- 既存のagenciesテーブルのstatusカラムを更新
ALTER TABLE agencies
DROP CONSTRAINT IF EXISTS agencies_status_check;

ALTER TABLE agencies
ADD CONSTRAINT agencies_status_check
CHECK (status IN ('pending', 'active', 'suspended', 'inactive', 'rejected'));

-- デフォルト値を'pending'に変更
ALTER TABLE agencies
ALTER COLUMN status SET DEFAULT 'pending';

-- 既存のactiveレコードはそのまま維持
-- 新規レコードは自動的にpendingになる

-- 更新履歴テーブルを作成（監査用）
CREATE TABLE IF NOT EXISTS agency_status_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    changed_by VARCHAR(255),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックスを追加
CREATE INDEX idx_agency_status_history_agency_id
ON agency_status_history(agency_id);

CREATE INDEX idx_agency_status_history_created_at
ON agency_status_history(created_at);

-- コメント追加
COMMENT ON COLUMN agencies.status IS '代理店ステータス: pending=承認待ち, active=有効, suspended=一時停止, inactive=無効, rejected=非承認';
COMMENT ON TABLE agency_status_history IS '代理店ステータス変更履歴';

-- 確認クエリ
SELECT
    'Migration completed successfully' as message,
    COUNT(*) as total_agencies,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE status = 'active') as active_count
FROM agencies;