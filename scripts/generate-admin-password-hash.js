#!/usr/bin/env node

/**
 * 管理者パスワードハッシュ生成ツール
 *
 * 使用方法:
 *   node scripts/generate-admin-password-hash.js
 *
 * または引数でパスワードを指定:
 *   node scripts/generate-admin-password-hash.js "YourSecurePassword123!"
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

// コマンドライン引数からパスワードを取得
const passwordArg = process.argv[2];

async function generateHash(password) {
    // パスワード強度チェック
    if (password.length < 12) {
        console.error('⚠️  警告: パスワードが短すぎます（最低12文字推奨）');
    }

    if (!/[A-Z]/.test(password)) {
        console.error('⚠️  警告: 大文字を含めることを推奨します');
    }

    if (!/[a-z]/.test(password)) {
        console.error('⚠️  警告: 小文字を含めることを推奨します');
    }

    if (!/[0-9]/.test(password)) {
        console.error('⚠️  警告: 数字を含めることを推奨します');
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
        console.error('⚠️  警告: 記号を含めることを推奨します');
    }

    console.log('\n🔐 パスワードハッシュを生成中...\n');

    // bcryptでハッシュ化（rounds=10）
    const hash = await bcrypt.hash(password, 10);

    console.log('✅ 生成完了！\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Netlify環境変数に以下を設定してください:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('ADMIN_USERNAME=admin');
    console.log(`ADMIN_PASSWORD_HASH=${hash}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📝 設定手順:');
    console.log('1. https://app.netlify.com にアクセス');
    console.log('2. プロジェクトを選択');
    console.log('3. Site settings → Environment variables');
    console.log('4. 上記の値を追加/更新');
    console.log('5. デプロイを再実行\n');

    console.log('⚠️  重要: 古い ADMIN_PASSWORD (平文) は削除してください\n');

    // 検証
    console.log('🧪 検証中...');
    const isValid = await bcrypt.compare(password, hash);
    if (isValid) {
        console.log('✅ ハッシュ検証成功\n');
    } else {
        console.error('❌ ハッシュ検証失敗\n');
    }
}

if (passwordArg) {
    // コマンドライン引数からパスワードを使用
    generateHash(passwordArg).catch(console.error);
} else {
    // 対話的にパスワードを入力
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 管理者パスワードハッシュ生成ツール');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('推奨パスワード要件:');
    console.log('  • 12文字以上');
    console.log('  • 大文字・小文字・数字・記号を含む');
    console.log('  • 推測されにくいランダムな文字列\n');

    rl.question('管理者パスワードを入力してください: ', (password) => {
        rl.close();

        if (!password || password.trim().length === 0) {
            console.error('\n❌ エラー: パスワードが空です');
            process.exit(1);
        }

        generateHash(password.trim()).catch(console.error);
    });
}
