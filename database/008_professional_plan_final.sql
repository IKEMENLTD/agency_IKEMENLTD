-- プロフェッショナルプラン対応 - 最終版
-- 2025-01-17

-- ステップ1: まず依存しているすべてのオブジェクトを確認
DO $$
DECLARE
    r RECORD;
BEGIN
    -- subscription_statusカラムに依存するすべてのビューを削除
    FOR r IN
        SELECT DISTINCT depobj.relname AS view_name
        FROM pg_depend AS dep
        JOIN pg_rewrite AS rewr ON dep.objid = rewr.oid
        JOIN pg_class AS depobj ON rewr.ev_class = depobj.oid
        JOIN pg_class AS refobj ON dep.refobjid = refobj.oid
        JOIN pg_attribute AS attr ON dep.refobjid = attr.attrelid AND dep.refobjsubid = attr.attnum
        WHERE refobj.relname = 'users'
        AND attr.attname = 'subscription_status'
        AND depobj.relkind = 'v'
    LOOP
        EXECUTE 'DROP VIEW IF EXISTS ' || r.view_name || ' CASCADE';
        RAISE NOTICE 'Dropped view: %', r.view_name;
    END LOOP;
END $$;

-- ステップ2: 既存の制約を削除
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_subscription_status_check;

-- ステップ3: カラムの型を変更（これで必ずできるはず）
ALTER TABLE users
ALTER COLUMN subscription_status TYPE text;

-- ステップ4: 新しい制約を追加
ALTER TABLE users
ADD CONSTRAINT users_subscription_status_check
CHECK (subscription_status IN ('free', 'premium', 'professional'));

-- ステップ5: プロフェッショナルプラン用のフィールド追加
ALTER TABLE users
ADD COLUMN IF NOT EXISTS payment_start_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_reset_month integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS priority_support boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS assigned_engineer_id text,
ADD COLUMN IF NOT EXISTS professional_features jsonb DEFAULT '{}';

-- ステップ6: インデックスの追加
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_priority_support ON users(priority_support);

-- ステップ7: 重要なビューを再作成
-- active_sessions ビュー
CREATE VIEW active_sessions AS
SELECT
    cs.id,
    cs.user_id,
    cs.status,
    cs.category,
    cs.created_at,
    u.subscription_status,
    u.display_name
FROM conversation_sessions cs
JOIN users u ON u.display_name = cs.user_id
WHERE cs.status = 'active';

-- user_generation_stats ビュー
CREATE VIEW user_generation_stats AS
SELECT
    u.display_name,
    u.subscription_status,
    u.monthly_usage_count,
    u.total_requests,
    COUNT(DISTINCT gc.id) as codes_generated,
    COUNT(DISTINCT cs.id) as share_links_created
FROM users u
LEFT JOIN generated_codes gc ON gc.user_id = u.display_name
LEFT JOIN code_shares cs ON cs.user_id = u.display_name
GROUP BY u.display_name, u.subscription_status, u.monthly_usage_count, u.total_requests;

-- subscription_statistics ビュー
CREATE VIEW subscription_statistics AS
SELECT
    subscription_status,
    COUNT(*) as user_count,
    COUNT(*) FILTER (WHERE last_active_at > now() - interval '7 days') as active_last_7days,
    COUNT(*) FILTER (WHERE last_active_at > now() - interval '30 days') as active_last_30days,
    COUNT(*) FILTER (WHERE subscription_status = 'professional') as professional_users
FROM users
GROUP BY subscription_status;

-- ステップ8: シーケンスを先に作成（チケット番号用）
CREATE SEQUENCE IF NOT EXISTS ticket_seq START 1;

-- プロフェッショナルプラン用の新しいテーブル
CREATE TABLE IF NOT EXISTS professional_support_tickets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id text NOT NULL,
    ticket_number text UNIQUE NOT NULL DEFAULT 'PST-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('ticket_seq')::text, 5, '0'),
    priority text NOT NULL DEFAULT 'high' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    subject text NOT NULL,
    description text NOT NULL,
    assigned_engineer_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);

-- コメントを追加
COMMENT ON COLUMN users.subscription_status IS 'ユーザーのサブスクリプションステータス（free/premium/professional）';
COMMENT ON COLUMN users.payment_start_date IS '決済開始日（月次リセットの基準日）';
COMMENT ON COLUMN users.last_reset_month IS '最後にリセットした月数（決済日からの経過月数）';
COMMENT ON COLUMN users.priority_support IS 'プロフェッショナルプランの優先サポートフラグ';
COMMENT ON COLUMN users.assigned_engineer_id IS '専任エンジニアのID';
COMMENT ON COLUMN users.professional_features IS 'プロフェッショナルプランの機能フラグ';

-- 成功メッセージ
DO $$
BEGIN
    RAISE NOTICE 'Professional plan migration completed successfully!';
END $$;