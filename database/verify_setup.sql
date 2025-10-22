-- ===================================
-- データベースセットアップ確認スクリプト
-- Supabase SQL Editor で実行してください
-- ===================================

-- 1. テーブル存在確認
SELECT
    '📊 テーブル存在確認' AS check_type,
    tablename,
    CASE
        WHEN tablename IN ('agencies', 'agency_users', 'agency_tracking_links',
                          'agency_tracking_visits', 'agency_conversions', 'agency_commissions')
        THEN '✅ 存在します'
        ELSE '❌ 存在しません'
    END AS status
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename LIKE 'agenc%'
ORDER BY tablename;

-- 2. 代理店アカウント確認
SELECT
    '🏢 代理店アカウント確認' AS check_type,
    COUNT(*) AS total_agencies,
    COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_agencies,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_agencies
FROM agencies;

-- 3. 代理店ユーザー確認
SELECT
    '👤 代理店ユーザー確認' AS check_type,
    au.email,
    au.name,
    a.name AS agency_name,
    a.status AS agency_status,
    au.is_active AS user_active,
    LEFT(au.password_hash, 7) AS hash_prefix,
    CASE
        WHEN LENGTH(au.password_hash) > 50 THEN '✅ パスワード設定済み'
        ELSE '❌ パスワード未設定'
    END AS password_status
FROM agency_users au
JOIN agencies a ON au.agency_id = a.id
WHERE au.email LIKE '%test-agency.com'
ORDER BY au.email;

-- 4. トラッキングリンク統計
SELECT
    '🔗 トラッキングリンク統計' AS check_type,
    COUNT(*) AS total_links,
    COUNT(CASE WHEN is_active = true THEN 1 END) AS active_links,
    SUM(visit_count) AS total_visits,
    SUM(conversion_count) AS total_conversions
FROM agency_tracking_links;

-- 5. 環境準備状況サマリー
SELECT
    '📋 セットアップ状況サマリー' AS summary,
    (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agenc%') AS tables_count,
    (SELECT COUNT(*) FROM agencies) AS agencies_count,
    (SELECT COUNT(*) FROM agency_users WHERE email LIKE '%test-agency.com') AS test_users_count,
    CASE
        WHEN (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agenc%') >= 6
             AND (SELECT COUNT(*) FROM agency_users WHERE email LIKE '%test-agency.com') >= 10
        THEN '✅ セットアップ完了'
        WHEN (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agenc%') >= 6
        THEN '⚠️ テーブルOK、テストアカウント未作成'
        ELSE '❌ テーブル未作成'
    END AS setup_status;
