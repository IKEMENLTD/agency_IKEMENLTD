-- ================================================================
-- ログイン失敗の原因調査SQL
-- ================================================================

-- 1. agency_users テーブルにデータが存在するか確認
SELECT
    '=== agency_users テーブルの全データ ===' as check_type;

SELECT
    id,
    email,
    name,
    role,
    agency_id,
    is_active,
    created_at,
    CASE
        WHEN password_hash IS NULL THEN '❌ NULL'
        WHEN password_hash = '' THEN '❌ 空文字'
        WHEN LENGTH(password_hash) < 10 THEN '⚠️ 短すぎる (' || LENGTH(password_hash) || '文字)'
        ELSE '✅ 存在する (' || LENGTH(password_hash) || '文字)'
    END as password_status
FROM agency_users
ORDER BY created_at DESC;

-- 2. agencies テーブルにデータが存在するか確認
SELECT
    '=== agencies テーブルの全データ ===' as check_type;

SELECT
    id,
    code,
    name,
    email,
    contact_email,
    level,
    own_commission_rate,
    status,
    created_at
FROM agencies
ORDER BY created_at DESC;

-- 3. info@ikemen.ltd のユーザーが存在するか確認
SELECT
    '=== info@ikemen.ltd ユーザーの詳細 ===' as check_type;

SELECT
    au.id as user_id,
    au.email,
    au.name as user_name,
    au.role,
    au.is_active,
    au.agency_id,
    a.name as agency_name,
    a.code as agency_code,
    a.status as agency_status,
    CASE
        WHEN au.password_hash IS NULL THEN '❌ パスワードハッシュがNULL'
        WHEN au.password_hash = '' THEN '❌ パスワードハッシュが空文字'
        ELSE '✅ パスワードハッシュ存在 (長さ: ' || LENGTH(au.password_hash) || ')'
    END as password_check
FROM agency_users au
LEFT JOIN agencies a ON au.agency_id = a.id
WHERE au.email = 'info@ikemen.ltd';

-- 4. テーブル構造の確認
SELECT
    '=== agency_users テーブル構造 ===' as check_type;

SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'agency_users'
ORDER BY ordinal_position;

-- 5. レコード数カウント
SELECT
    '=== レコード数サマリー ===' as check_type;

SELECT
    'agency_users' as table_name,
    COUNT(*) as record_count
FROM agency_users
UNION ALL
SELECT
    'agencies' as table_name,
    COUNT(*) as record_count
FROM agencies
UNION ALL
SELECT
    'agency_tracking_links' as table_name,
    COUNT(*) as record_count
FROM agency_tracking_links
UNION ALL
SELECT
    'services' as table_name,
    COUNT(*) as record_count
FROM services;
