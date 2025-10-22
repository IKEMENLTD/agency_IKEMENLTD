-- Vision API使用履歴テーブル
CREATE TABLE IF NOT EXISTS vision_usage (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  analysis_result TEXT,
  image_size_bytes INTEGER,
  processing_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_vision_user_date ON vision_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_hash ON vision_usage (image_hash);
CREATE INDEX IF NOT EXISTS idx_vision_created ON vision_usage (created_at DESC);

-- 月間使用量ビュー（管理用）
CREATE OR REPLACE VIEW vision_usage_monthly AS
SELECT 
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as total_count,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) * 0.01275 as estimated_cost_usd,
  COUNT(*) * 1.91 as estimated_cost_jpy -- $1 = 150円で計算
FROM vision_usage
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- 日別使用量ビュー
CREATE OR REPLACE VIEW vision_usage_daily AS
SELECT 
  DATE_TRUNC('day', created_at) as day,
  COUNT(*) as total_count,
  COUNT(DISTINCT user_id) as unique_users
FROM vision_usage
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day DESC
LIMIT 30;