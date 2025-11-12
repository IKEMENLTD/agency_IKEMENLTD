-- 初期サービスデータ登録
-- 作成日: 2025-10-22
-- 対象: 4つのサービス（TaskMate AI、LiteWEB+、IT補助金、ものづくり補助金）

-- ===================================
-- 注意事項
-- ===================================
-- 以下の値は後で実際の値に置き換える必要があります：
-- 1. LINE認証情報（line_channel_id、line_channel_secret、line_channel_access_token、line_official_url）
-- 2. ドメイン（domain、tracking_base_url、app_redirect_url）
-- 3. 報酬率（default_commission_rate、subscription_price）

-- ===================================
-- 1. TaskMate AI（既存サービス）
-- ===================================

INSERT INTO services (
  id,
  name,
  description,
  domain,
  tracking_base_url,
  app_redirect_url,
  line_channel_id,
  line_channel_secret,
  line_channel_access_token,
  line_official_url,
  default_commission_rate,
  default_referral_rate,
  subscription_price,
  status
) VALUES (
  'b5e8f3c2-1a4d-4e9b-8f6a-2c3d4e5f6a7b',  -- 固定UUID（既存データとの互換性）
  'TaskMate AI',
  'AI搭載のタスク管理アシスタント',
  'taskmateai.net',
  'https://taskmateai.net/t',
  'https://taskmateai.net/app',
  'TASKMATE_LINE_CHANNEL_ID',          -- ⚠️ 後で実際の値に置き換え
  'TASKMATE_LINE_CHANNEL_SECRET',      -- ⚠️ 後で実際の値に置き換え
  'TASKMATE_LINE_ACCESS_TOKEN',        -- ⚠️ 後で実際の値に置き換え
  'https://lin.ee/US4Qffq',            -- ✅ TaskMate AI LINE公式アカウント
  20.00,                               -- 20%報酬
  2.00,                                -- 2%リファラル報酬
  10000,                               -- 月額10,000円
  'active'
) ON CONFLICT (id) DO NOTHING;

-- ===================================
-- 2. LiteWEB+（新規サービス）
-- ===================================

INSERT INTO services (
  id,
  name,
  description,
  domain,
  tracking_base_url,
  app_redirect_url,
  line_channel_id,
  line_channel_secret,
  line_channel_access_token,
  line_official_url,
  default_commission_rate,
  default_referral_rate,
  subscription_price,
  status
) VALUES (
  gen_random_uuid(),
  'LiteWEB+',
  '軽量・高速なWebサービスプラットフォーム',
  'liteweb.ikemen.ltd',               -- ⚠️ 実際のドメインに置き換え
  'https://liteweb.ikemen.ltd/t',     -- ⚠️ 実際のドメインに置き換え
  'https://liteweb.ikemen.ltd/app',   -- ⚠️ 実際のドメインに置き換え
  'LITEWEB_LINE_CHANNEL_ID',           -- ⚠️ LINE Developers で取得後に置き換え
  'LITEWEB_LINE_CHANNEL_SECRET',       -- ⚠️ LINE Developers で取得後に置き換え
  'LITEWEB_LINE_ACCESS_TOKEN',         -- ⚠️ LINE Developers で取得後に置き換え
  'https://lin.ee/XXXXXXX',            -- ⚠️ LINE公式アカウント作成後に置き換え
  15.00,                               -- 15%報酬（仮）
  2.00,                                -- 2%リファラル報酬
  8000,                                -- 月額8,000円（仮）
  'active'
);

-- ===================================
-- 3. IT補助金（新規サービス）
-- ===================================

INSERT INTO services (
  id,
  name,
  description,
  domain,
  tracking_base_url,
  app_redirect_url,
  line_channel_id,
  line_channel_secret,
  line_channel_access_token,
  line_official_url,
  default_commission_rate,
  default_referral_rate,
  subscription_price,
  status
) VALUES (
  gen_random_uuid(),
  'IT補助金サポート',
  'IT補助金申請をLINEでサポート',
  'it-subsidy.ikemen.ltd',            -- ⚠️ 実際のドメインに置き換え
  'https://it-subsidy.ikemen.ltd/t',  -- ⚠️ 実際のドメインに置き換え
  'https://it-subsidy.ikemen.ltd/app',-- ⚠️ 実際のドメインに置き換え
  'IT_SUBSIDY_LINE_CHANNEL_ID',        -- ⚠️ LINE Developers で取得後に置き換え
  'IT_SUBSIDY_LINE_CHANNEL_SECRET',    -- ⚠️ LINE Developers で取得後に置き換え
  'IT_SUBSIDY_LINE_ACCESS_TOKEN',      -- ⚠️ LINE Developers で取得後に置き換え
  'https://lin.ee/YYYYYYY',            -- ⚠️ LINE公式アカウント作成後に置き換え
  10.00,                               -- 10%報酬（仮）
  2.00,                                -- 2%リファラル報酬
  50000,                               -- 月額50,000円（仮・コンサル料金）
  'active'
);

-- ===================================
-- 4. ものづくり補助金（新規サービス）
-- ===================================

INSERT INTO services (
  id,
  name,
  description,
  domain,
  tracking_base_url,
  app_redirect_url,
  line_channel_id,
  line_channel_secret,
  line_channel_access_token,
  line_official_url,
  default_commission_rate,
  default_referral_rate,
  subscription_price,
  status
) VALUES (
  gen_random_uuid(),
  'ものづくり補助金サポート',
  'ものづくり補助金申請をLINEでサポート',
  'monozukuri.ikemen.ltd',            -- ⚠️ 実際のドメインに置き換え
  'https://monozukuri.ikemen.ltd/t',  -- ⚠️ 実際のドメインに置き換え
  'https://monozukuri.ikemen.ltd/app',-- ⚠️ 実際のドメインに置き換え
  'MONOZUKURI_LINE_CHANNEL_ID',        -- ⚠️ LINE Developers で取得後に置き換え
  'MONOZUKURI_LINE_CHANNEL_SECRET',    -- ⚠️ LINE Developers で取得後に置き換え
  'MONOZUKURI_LINE_ACCESS_TOKEN',      -- ⚠️ LINE Developers で取得後に置き換え
  'https://lin.ee/ZZZZZZZ',            -- ⚠️ LINE公式アカウント作成後に置き換え
  10.00,                               -- 10%報酬（仮）
  2.00,                                -- 2%リファラル報酬
  80000,                               -- 月額80,000円（仮・コンサル料金）
  'active'
);

-- ===================================
-- 確認クエリ
-- ===================================

-- 登録されたサービスを確認
SELECT
  id,
  name,
  domain,
  default_commission_rate,
  subscription_price,
  status
FROM services
ORDER BY name;

-- 完了メッセージ
SELECT '4つのサービスが登録されました。LINE認証情報とドメインを後で更新してください。' AS message;
