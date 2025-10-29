-- ========================================
-- Migration 007: 補助金ナビゲーターのLINE設定を更新
-- ========================================
-- 作成日: 2025-10-29
-- 説明: 補助金ナビゲーターサービスにLINE認証情報を追加

-- ========================================
-- Step 1: 補助金ナビゲーターのLINE設定を更新
-- ========================================

UPDATE services
SET
    line_channel_id = 'YOUR_SUBSIDY_NAV_CHANNEL_ID',           -- ⚠️ LINE Developers で取得した Channel ID
    line_channel_secret = 'YOUR_SUBSIDY_NAV_CHANNEL_SECRET',   -- ⚠️ LINE Developers で取得した Channel Secret
    line_channel_access_token = 'YOUR_SUBSIDY_NAV_ACCESS_TOKEN', -- ⚠️ LINE Developers で取得した Access Token
    line_official_url = 'https://lin.ee/fbyGDxB',              -- ✅ 既に正しい値
    updated_at = NOW()
WHERE code = 'SUBSIDY_NAV';

-- ========================================
-- Step 2: TaskMate AI の LINE 設定も確認・更新
-- ========================================

UPDATE services
SET
    line_channel_id = COALESCE(line_channel_id, 'YOUR_TASKMATE_CHANNEL_ID'),
    line_channel_secret = COALESCE(line_channel_secret, 'YOUR_TASKMATE_CHANNEL_SECRET'),
    line_channel_access_token = COALESCE(line_channel_access_token, 'YOUR_TASKMATE_ACCESS_TOKEN'),
    line_official_url = COALESCE(line_official_url, 'https://lin.ee/XXXXXXX'),
    updated_at = NOW()
WHERE code = 'TASKMATE_AI';

-- ========================================
-- Step 3: 確認クエリ
-- ========================================

SELECT
    code,
    name,
    line_official_url,
    CASE
        WHEN line_channel_id LIKE 'YOUR_%' THEN '⚠️ 未設定'
        ELSE '✅ 設定済み'
    END as channel_id_status,
    CASE
        WHEN line_channel_secret LIKE 'YOUR_%' THEN '⚠️ 未設定'
        ELSE '✅ 設定済み'
    END as channel_secret_status,
    CASE
        WHEN line_channel_access_token LIKE 'YOUR_%' THEN '⚠️ 未設定'
        ELSE '✅ 設定済み'
    END as access_token_status
FROM services
ORDER BY created_at;

-- マイグレーション完了
SELECT 'Migration 007 completed successfully!' AS status;
