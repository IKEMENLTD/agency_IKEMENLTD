-- ===================================
-- 課金情報取得のためのデータ構造確認
-- ===================================

-- 1. usersテーブルのサブスクリプション関連カラムを確認
SELECT
    '👤 usersテーブルの課金関連カラム' AS check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name IN (
        'id', 'line_user_id', 'display_name',
        'subscription_status', 'subscription_started_at', 'subscription_end_date',
        'stripe_customer_id', 'payment_start_date', 'is_premium'
    )
ORDER BY
    CASE column_name
        WHEN 'id' THEN 1
        WHEN 'line_user_id' THEN 2
        WHEN 'display_name' THEN 3
        WHEN 'subscription_status' THEN 4
        WHEN 'subscription_started_at' THEN 5
        WHEN 'subscription_end_date' THEN 6
        ELSE 7
    END;

-- 2. agency_conversionsテーブルの構造確認
SELECT
    '🔄 agency_conversionsテーブル構造' AS check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agency_conversions'
ORDER BY ordinal_position;

-- 3. 代理店経由で登録されたユーザーの課金状態を確認（サンプルクエリ）
SELECT
    '💰 代理店経由ユーザーの課金状態（サンプル10件）' AS check_type,
    u.id AS user_id,
    u.display_name,
    u.subscription_status,
    u.subscription_started_at,
    u.subscription_end_date,
    ac.agency_id,
    ac.conversion_type,
    ac.created_at AS conversion_date
FROM users u
JOIN agency_conversions ac ON u.id = ac.user_id
WHERE ac.agency_id IS NOT NULL
ORDER BY ac.created_at DESC
LIMIT 10;

-- 4. 代理店ごとの課金中ユーザー数を確認
SELECT
    '📊 代理店別の課金中ユーザー数' AS check_type,
    a.name AS agency_name,
    a.code AS agency_code,
    COUNT(DISTINCT CASE
        WHEN u.subscription_status = 'active' OR u.subscription_status = 'trialing'
        THEN u.id
    END) AS active_subscribers,
    COUNT(DISTINCT ac.user_id) AS total_conversions
FROM agencies a
LEFT JOIN agency_conversions ac ON a.id = ac.agency_id
LEFT JOIN users u ON ac.user_id = u.id
GROUP BY a.id, a.name, a.code
ORDER BY active_subscribers DESC;

-- 5. line_user_idでの連携確認（もしusers.line_user_idがある場合）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'line_user_id'
    ) THEN
        RAISE NOTICE '✅ users.line_user_id が存在します - LINE IDでの連携が可能';
    ELSE
        RAISE NOTICE '⚠️ users.line_user_id が存在しません - user_idでの直接連携が必要';
    END IF;
END $$;

-- 6. agency_conversionsとusersの連携可能性を確認
SELECT
    '🔗 agency_conversions → users 連携確認' AS check_type,
    COUNT(DISTINCT ac.user_id) AS conversions_with_user_id,
    COUNT(DISTINCT u.id) AS matched_users,
    CASE
        WHEN COUNT(DISTINCT ac.user_id) = COUNT(DISTINCT u.id)
        THEN '✅ 完全マッチ'
        ELSE '⚠️ 一部マッチなし'
    END AS match_status
FROM agency_conversions ac
LEFT JOIN users u ON ac.user_id = u.id;
