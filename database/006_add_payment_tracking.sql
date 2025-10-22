-- プレミアム会員の決済日ベース更新用カラムを追加
ALTER TABLE users
ADD COLUMN IF NOT EXISTS payment_start_date TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_reset_month INTEGER DEFAULT 0;

-- インデックスを追加（パフォーマンス最適化）
CREATE INDEX IF NOT EXISTS idx_users_payment_start_date ON users(payment_start_date);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);

-- 既存のプレミアムユーザーのpayment_start_dateを設定（初回のみ）
UPDATE users
SET payment_start_date = CURRENT_TIMESTAMP
WHERE subscription_status = 'premium'
AND payment_start_date IS NULL;

-- コメント追加
COMMENT ON COLUMN users.payment_start_date IS 'プレミアムプラン決済開始日（月次更新の基準日）';
COMMENT ON COLUMN users.last_reset_month IS '最後にリセットした月数（決済日から何ヶ月目か）';