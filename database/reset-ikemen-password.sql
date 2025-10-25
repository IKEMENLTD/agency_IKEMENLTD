-- ================================================================
-- info@ikemen.ltd のパスワードを既知のものにリセット
-- ================================================================
--
-- 新しいパスワード: test1234
-- bcryptハッシュ（rounds=10）: $2a$10$N9qo8uLOickgx2ZMRZoMye1FeHRhp9MlY3SXQZ3W4w0r7Qp4Qd8/6
--
-- ================================================================

-- パスワードを test1234 に更新
UPDATE agency_users
SET
    password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMye1FeHRhp9MlY3SXQZ3W4w0r7Qp4Qd8/6',
    updated_at = NOW()
WHERE email = 'info@ikemen.ltd';

-- 確認
SELECT
    email,
    name,
    role,
    is_active,
    agency_id,
    LENGTH(password_hash) as password_length,
    updated_at
FROM agency_users
WHERE email = 'info@ikemen.ltd';

-- ================================================================
-- テスト手順:
-- ================================================================
-- 1. このSQLを実行
-- 2. ログインを試行:
--    Email: info@ikemen.ltd
--    Password: test1234
-- 3. 結果:
--    - ログイン成功 ✅ → 元のパスワードが間違っていた/忘れていた
--    - ログイン失敗 ❌ → bcrypt、JOIN、環境変数等の問題
-- ================================================================

-- ================================================================
-- ログイン成功後、本番パスワードに変更してください:
-- ================================================================
-- 方法1: ダッシュボードの「パスワード変更」機能を使用
-- 方法2: 以下のNode.jsコードでハッシュを生成してUPDATE:
--
-- const bcrypt = require('bcryptjs');
-- const newPassword = 'あなたの新しいパスワード';
-- bcrypt.hash(newPassword, 10).then(hash => {
--     console.log('UPDATE agency_users SET password_hash = \'' + hash + '\' WHERE email = \'info@ikemen.ltd\';');
-- });
-- ================================================================
