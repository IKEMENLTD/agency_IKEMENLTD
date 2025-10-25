-- ================================================================
-- info@ikemen.ltd ユーザーの簡易確認
-- ================================================================

-- 1. メールアドレスで完全一致検索
SELECT
    '=== 完全一致検索: info@ikemen.ltd ===' as check_type;

SELECT
    id,
    email,
    name,
    role,
    is_active,
    agency_id,
    LENGTH(password_hash) as password_length,
    created_at
FROM agency_users
WHERE email = 'info@ikemen.ltd';

-- 2. 部分一致検索（大文字小文字、スペースの問題を検出）
SELECT
    '=== 部分一致検索: ikemen ===' as check_type;

SELECT
    id,
    email,
    name,
    role,
    is_active,
    agency_id,
    LENGTH(password_hash) as password_length
FROM agency_users
WHERE email LIKE '%ikemen%';

-- 3. 全ユーザーのメールアドレス一覧
SELECT
    '=== 全ユーザーのメールアドレス一覧 ===' as check_type;

SELECT
    id,
    email,
    name,
    role,
    is_active,
    LENGTH(password_hash) as password_length
FROM agency_users
ORDER BY created_at DESC;

-- 4. agencies テーブルの確認
SELECT
    '=== agencies テーブルの全データ ===' as check_type;

SELECT
    id,
    code,
    name,
    email,
    status,
    created_at
FROM agencies
ORDER BY created_at DESC
LIMIT 20;
