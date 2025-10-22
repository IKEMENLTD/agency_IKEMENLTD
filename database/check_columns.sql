-- ===================================
-- 完全なカラムリスト確認（NULLABLEとNOT NULL両方）
-- Supabase SQL Editor で実行してください
-- ===================================

-- 1. agencies テーブルの全カラム確認
SELECT
    '🏢 agencies' AS table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE
        WHEN column_name IN ('id', 'code', 'name', 'contact_email') THEN '✅ 必須カラム'
        ELSE '⚪ オプション'
    END AS importance
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agencies'
ORDER BY
    CASE
        WHEN column_name = 'id' THEN 1
        WHEN column_name = 'code' THEN 2
        WHEN column_name = 'name' THEN 3
        WHEN column_name = 'contact_email' THEN 4
        ELSE 5
    END,
    column_name;

-- 2. agency_users テーブルの全カラム確認
SELECT
    '👤 agency_users' AS table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE
        WHEN column_name IN ('id', 'agency_id', 'email', 'password_hash', 'name') THEN '✅ 必須カラム'
        ELSE '⚪ オプション'
    END AS importance
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agency_users'
ORDER BY
    CASE
        WHEN column_name = 'id' THEN 1
        WHEN column_name = 'agency_id' THEN 2
        WHEN column_name = 'email' THEN 3
        WHEN column_name = 'password_hash' THEN 4
        WHEN column_name = 'name' THEN 5
        ELSE 6
    END,
    column_name;

-- 3. agency_tracking_links テーブルの全カラム確認
SELECT
    '🔗 agency_tracking_links' AS table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE
        WHEN column_name IN ('id', 'agency_id', 'created_by', 'tracking_code', 'name', 'line_friend_url') THEN '✅ 必須カラム'
        ELSE '⚪ オプション'
    END AS importance
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agency_tracking_links'
ORDER BY
    CASE
        WHEN column_name = 'id' THEN 1
        WHEN column_name = 'agency_id' THEN 2
        WHEN column_name = 'tracking_code' THEN 3
        WHEN column_name = 'name' THEN 4
        ELSE 5
    END,
    column_name;

-- 4. 主キー制約の確認
SELECT
    '🔑 主キー制約' AS check_type,
    tc.table_name,
    kcu.column_name,
    '✅ PRIMARY KEY' AS constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name LIKE 'agenc%'
ORDER BY tc.table_name, kcu.ordinal_position;

-- 5. UNIQUE制約の確認
SELECT
    '🔒 UNIQUE制約' AS check_type,
    tc.table_name,
    kcu.column_name,
    '✅ UNIQUE' AS constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_schema = 'public'
    AND tc.table_name LIKE 'agenc%'
ORDER BY tc.table_name, kcu.column_name;

-- 6. 外部キー制約の確認
SELECT
    '🔗 外部キー制約' AS check_type,
    tc.table_name AS from_table,
    kcu.column_name AS from_column,
    ccu.table_name AS to_table,
    ccu.column_name AS to_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name LIKE 'agenc%'
ORDER BY tc.table_name, kcu.column_name;

-- 7. テストデータ確認
SELECT
    '📊 データ存在確認' AS check_type,
    'agencies' AS table_name,
    COUNT(*) AS row_count,
    COUNT(CASE WHEN id IS NOT NULL THEN 1 END) AS has_id,
    COUNT(CASE WHEN code IS NOT NULL THEN 1 END) AS has_code,
    COUNT(CASE WHEN name IS NOT NULL THEN 1 END) AS has_name
FROM agencies
UNION ALL
SELECT
    '📊 データ存在確認',
    'agency_users',
    COUNT(*),
    COUNT(CASE WHEN id IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN email IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN password_hash IS NOT NULL THEN 1 END)
FROM agency_users
UNION ALL
SELECT
    '📊 データ存在確認',
    'agency_tracking_links',
    COUNT(*),
    COUNT(CASE WHEN id IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN tracking_code IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN name IS NOT NULL THEN 1 END)
FROM agency_tracking_links;
