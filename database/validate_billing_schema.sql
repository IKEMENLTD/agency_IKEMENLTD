-- ===================================
-- 課金機能のデータベーススキーマ検証
-- ===================================

-- 1. 必須テーブルの存在確認
SELECT
    '📋 必須テーブル確認' AS check_type,
    table_name,
    CASE
        WHEN table_name IN ('agencies', 'agency_users', 'agency_conversions', 'users')
        THEN '✅ 存在'
        ELSE '❌ 不足'
    END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
    AND table_name IN ('agencies', 'agency_users', 'agency_conversions', 'agency_commissions', 'users')
ORDER BY table_name;

-- 2. agency_conversions の必須カラム確認
SELECT
    '🔗 agency_conversions テーブルのカラム' AS check_type,
    column_name,
    data_type,
    is_nullable,
    CASE
        WHEN column_name IN ('id', 'agency_id', 'tracking_link_id', 'user_id', 'conversion_type')
        THEN '✅ 必須カラム'
        ELSE '⚪ オプション'
    END AS importance
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agency_conversions'
ORDER BY
    CASE
        WHEN column_name = 'id' THEN 1
        WHEN column_name = 'agency_id' THEN 2
        WHEN column_name = 'tracking_link_id' THEN 3
        WHEN column_name = 'user_id' THEN 4
        WHEN column_name = 'conversion_type' THEN 5
        ELSE 6
    END;

-- 3. users テーブルのサブスクリプション関連カラム確認
SELECT
    '👤 users テーブルのサブスクリプションカラム' AS check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name IN (
        'id',
        'line_user_id',
        'display_name',
        'subscription_status',
        'subscription_started_at',
        'subscription_end_date',
        'is_premium',
        'stripe_customer_id'
    )
ORDER BY
    CASE column_name
        WHEN 'id' THEN 1
        WHEN 'line_user_id' THEN 2
        WHEN 'display_name' THEN 3
        WHEN 'subscription_status' THEN 4
        WHEN 'subscription_started_at' THEN 5
        WHEN 'subscription_end_date' THEN 6
        WHEN 'is_premium' THEN 7
        WHEN 'stripe_customer_id' THEN 8
    END;

-- 4. 外部キー制約の確認
SELECT
    '🔑 外部キー制約' AS check_type,
    tc.table_name AS from_table,
    kcu.column_name AS from_column,
    ccu.table_name AS to_table,
    ccu.column_name AS to_column,
    '✅ 設定済み' AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND (
        (tc.table_name = 'agency_conversions' AND kcu.column_name IN ('agency_id', 'user_id', 'tracking_link_id'))
        OR (tc.table_name = 'agency_commissions' AND kcu.column_name = 'agency_id')
    )
ORDER BY tc.table_name, kcu.column_name;

-- 5. agency_conversions と users の連携可能性テスト
DO $$
DECLARE
    user_id_exists BOOLEAN;
    conversion_count INTEGER;
    linked_count INTEGER;
BEGIN
    -- user_idカラムの存在確認
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'agency_conversions'
        AND column_name = 'user_id'
    ) INTO user_id_exists;

    IF user_id_exists THEN
        RAISE NOTICE '✅ agency_conversions.user_id カラムが存在します';

        -- データの連携状況を確認
        SELECT COUNT(*) INTO conversion_count FROM agency_conversions WHERE user_id IS NOT NULL;
        SELECT COUNT(DISTINCT ac.user_id)
        INTO linked_count
        FROM agency_conversions ac
        INNER JOIN users u ON ac.user_id = u.id;

        RAISE NOTICE '📊 user_idを持つコンバージョン: %', conversion_count;
        RAISE NOTICE '📊 usersテーブルとリンクされているコンバージョン: %', linked_count;

        IF conversion_count > 0 AND linked_count = conversion_count THEN
            RAISE NOTICE '✅ 全てのコンバージョンがusersテーブルとリンクされています';
        ELSIF conversion_count > 0 THEN
            RAISE NOTICE '⚠️  一部のコンバージョンがusersテーブルとリンクされていません';
        ELSE
            RAISE NOTICE 'ℹ️  まだコンバージョンデータがありません';
        END IF;
    ELSE
        RAISE NOTICE '❌ agency_conversions.user_id カラムが存在しません';
        RAISE NOTICE 'ℹ️  以下のSQLで追加してください:';
        RAISE NOTICE 'ALTER TABLE agency_conversions ADD COLUMN user_id UUID REFERENCES users(id);';
    END IF;
END $$;

-- 6. インデックスの確認
SELECT
    '📇 インデックス' AS check_type,
    schemaname,
    tablename,
    indexname,
    '✅ 設定済み' AS status
FROM pg_indexes
WHERE schemaname = 'public'
    AND (
        (tablename = 'agency_conversions' AND indexname LIKE '%user_id%')
        OR (tablename = 'agency_conversions' AND indexname LIKE '%agency_id%')
        OR (tablename = 'users' AND indexname LIKE '%subscription%')
    )
ORDER BY tablename, indexname;

-- 7. 総合診断
DO $$
DECLARE
    tables_ok BOOLEAN;
    columns_ok BOOLEAN;
    fk_ok BOOLEAN;
BEGIN
    -- テーブルチェック
    SELECT COUNT(*) >= 4 INTO tables_ok
    FROM information_schema.tables
    WHERE table_schema = 'public'
        AND table_name IN ('agencies', 'agency_users', 'agency_conversions', 'users');

    -- カラムチェック
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'agency_conversions' AND column_name = 'user_id'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'subscription_status'
    ) INTO columns_ok;

    -- 外部キーチェック
    SELECT COUNT(*) >= 1 INTO fk_ok
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'agency_conversions'
        AND constraint_name LIKE '%user_id%';

    -- 結果出力
    RAISE NOTICE '========================================';
    RAISE NOTICE '総合診断結果';
    RAISE NOTICE '========================================';

    IF tables_ok THEN
        RAISE NOTICE '✅ テーブル: OK';
    ELSE
        RAISE NOTICE '❌ テーブル: NG - 必須テーブルが不足しています';
    END IF;

    IF columns_ok THEN
        RAISE NOTICE '✅ カラム: OK';
    ELSE
        RAISE NOTICE '❌ カラム: NG - 必須カラムが不足しています';
    END IF;

    IF fk_ok THEN
        RAISE NOTICE '✅ 外部キー: OK';
    ELSE
        RAISE NOTICE '⚠️  外部キー: 一部不足している可能性があります';
    END IF;

    IF tables_ok AND columns_ok THEN
        RAISE NOTICE '';
        RAISE NOTICE '🎉 課金機能のデータベース構造は正常です！';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  一部の構造に問題があります。上記の詳細を確認してください。';
    END IF;
END $$;
