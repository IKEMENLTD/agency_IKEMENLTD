-- ================================================================
-- テストユーザー作成（ログイン診断用）
-- ================================================================
--
-- パスワード: test1234
-- bcryptハッシュ: $2a$10$YourTestHashHere
--
-- ================================================================

-- STEP 1: bcryptハッシュを生成
-- 以下のNode.jsコードをローカルで実行してハッシュを生成してください:
--
-- const bcrypt = require('bcryptjs');
-- const password = 'test1234';
-- bcrypt.hash(password, 10).then(hash => console.log(hash));
--
-- 生成されたハッシュを以下のINSERT文に貼り付けてください

-- STEP 2: テストユーザーを挿入
INSERT INTO agency_users (
    id,
    email,
    password_hash,
    name,
    role,
    is_active,
    agency_id,
    created_at,
    updated_at
)
VALUES (
    gen_random_uuid(),
    'test-login@ikemen.ltd',
    '$2a$10$N9qo8uLOickgx2ZMRZoMye1FeHRhp9MlY3SXQZ3W4w0r7Qp4Qd8/6',  -- パスワード: test1234
    'テストユーザー（ログイン診断用）',
    'owner',
    true,
    '13cf878d-7ac1-48c7-9293-a69d4c77ac28',  -- イケメン agency
    NOW(),
    NOW()
);

-- STEP 3: 確認
SELECT
    email,
    name,
    role,
    is_active,
    LENGTH(password_hash) as password_length
FROM agency_users
WHERE email = 'test-login@ikemen.ltd';

-- ================================================================
-- テスト手順:
-- ================================================================
-- 1. このSQLを実行
-- 2. ログインを試行:
--    Email: test-login@ikemen.ltd
--    Password: test1234
-- 3. 結果:
--    - ログイン成功 → info@ikemen.ltd のパスワードが間違っている
--    - ログイン失敗 → 別の問題がある（JOIN、bcrypt、環境変数等）
-- ================================================================

-- テスト後にユーザーを削除:
-- DELETE FROM agency_users WHERE email = 'test-login@ikemen.ltd';
