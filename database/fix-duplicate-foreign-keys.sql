-- ================================================================
-- 重複外部キー制約の削除
-- ================================================================
--
-- 問題: agency_users → agencies への外部キーが2つ存在
-- 1. agency_users_agency_id_fkey (元々存在)
-- 2. fk_agency_users_agency (setup-services-table.sql で追加)
--
-- Supabaseの埋め込みクエリがどちらを使うべきか判断できず、
-- PGRST201エラーが発生してログインが失敗する
--
-- 解決策: 重複している制約を削除
-- ================================================================

-- 1. agency_users テーブルの重複制約を削除
DO $$
BEGIN
    -- fk_agency_users_agency を削除（新しく追加したもの）
    ALTER TABLE agency_users DROP CONSTRAINT IF EXISTS fk_agency_users_agency;
    RAISE NOTICE '✅ agency_users: fk_agency_users_agency を削除';
EXCEPTION
    WHEN undefined_object THEN
        RAISE NOTICE 'ℹ️  agency_users: fk_agency_users_agency は既に存在しません';
END $$;

-- 2. agency_service_settings テーブルの重複制約を確認・削除
DO $$
BEGIN
    ALTER TABLE agency_service_settings DROP CONSTRAINT IF EXISTS fk_agency_service_settings_agency;
    RAISE NOTICE '✅ agency_service_settings: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 3. agency_tracking_links テーブルの重複制約を確認・削除
DO $$
BEGIN
    ALTER TABLE agency_tracking_links DROP CONSTRAINT IF EXISTS fk_agency_tracking_links_agency;
    RAISE NOTICE '✅ agency_tracking_links: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_tracking_links DROP CONSTRAINT IF EXISTS fk_agency_tracking_links_service;
    RAISE NOTICE '✅ agency_tracking_links: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_tracking_links DROP CONSTRAINT IF EXISTS fk_agency_tracking_links_created_by;
    RAISE NOTICE '✅ agency_tracking_links: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 4. agency_conversions テーブルの重複制約を確認・削除
DO $$
BEGIN
    ALTER TABLE agency_conversions DROP CONSTRAINT IF EXISTS fk_agency_conversions_agency;
    RAISE NOTICE '✅ agency_conversions: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE agency_conversions DROP CONSTRAINT IF EXISTS fk_agency_conversions_tracking_link;
    RAISE NOTICE '✅ agency_conversions: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 5. agency_commissions テーブルの重複制約を確認・削除
DO $$
BEGIN
    ALTER TABLE agency_commissions DROP CONSTRAINT IF EXISTS fk_agency_commissions_agency;
    RAISE NOTICE '✅ agency_commissions: 重複制約をクリーンアップ';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- ================================================================
-- 確認: 各テーブルの外部キー制約を表示
-- ================================================================

SELECT
    '=== agency_users の外部キー制約 ===' as check_type;

SELECT
    constraint_name,
    table_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'agency_users'
  AND constraint_type = 'FOREIGN KEY';

-- ================================================================
-- 期待される結果:
-- ================================================================
-- constraint_name              | table_name   | constraint_type
-- -----------------------------|--------------|----------------
-- agency_users_agency_id_fkey  | agency_users | FOREIGN KEY
--
-- ※ fk_agency_users_agency が削除されていることを確認
-- ================================================================

SELECT
    '✅ 重複制約の削除が完了しました' as status;
