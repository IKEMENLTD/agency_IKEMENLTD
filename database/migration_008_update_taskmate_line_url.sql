-- Migration: Update TaskMate AI LINE Official URL
-- Date: 2025-11-12
-- Description: TaskMate AIのLINE公式アカウントURLを更新
-- Reason: 正しいLINE友達追加URLに変更（https://lin.ee/US4Qffq）

-- ===================================
-- TaskMate AI のLINE URLを更新
-- ===================================

UPDATE services
SET
  line_official_url = 'https://lin.ee/US4Qffq',
  updated_at = NOW()
WHERE
  name = 'TaskMate AI'
  OR domain = 'taskmateai.net'
  OR id = 'b5e8f3c2-1a4d-4e9b-8f6a-2c3d4e5f6a7b';

-- 確認クエリ
SELECT
  id,
  name,
  domain,
  line_official_url,
  updated_at
FROM services
WHERE name = 'TaskMate AI';

-- 完了メッセージ
SELECT 'TaskMate AI のLINE URLを https://lin.ee/US4Qffq に更新しました。' AS message;
