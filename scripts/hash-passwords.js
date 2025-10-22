const bcrypt = require('bcryptjs');

// テストアカウントのパスワード
const accounts = [
    { email: 'account1@test-agency.com', password: 'Kx9mP#2nQ@7z' },
    { email: 'account2@test-agency.com', password: 'Jy3$Rt8Lw&5v' },
    { email: 'account3@test-agency.com', password: 'Nm6!Fq4Xp*9s' },
    { email: 'account4@test-agency.com', password: 'Tz2@Hk7Yw#3b' },
    { email: 'account5@test-agency.com', password: 'Gv8&Cd5Mx!4n' },
    { email: 'account6@test-agency.com', password: 'Pq3#Ws9Rb@6j' },
    { email: 'account7@test-agency.com', password: 'Fx7!Nt2Ky&8m' },
    { email: 'account8@test-agency.com', password: 'Lz4@Jp6Qw#5c' },
    { email: 'account9@test-agency.com', password: 'Dv9&Hs3Tm!7x' },
    { email: 'account10@test-agency.com', password: 'Bw5#Yr8Kn@2p' }
];

// パスワードをハッシュ化して表示
async function hashPasswords() {
    console.log('-- パスワードハッシュ生成結果');
    console.log('-- 以下のSQL文をSupabaseで実行してください\n');

    for (const account of accounts) {
        const hash = await bcrypt.hash(account.password, 10);
        console.log(`-- ${account.email}`);
        console.log(`-- Password: ${account.password}`);
        console.log(`UPDATE agency_users SET password_hash = '${hash}' WHERE email = '${account.email}';\n`);
    }
}

// 実行
hashPasswords().catch(console.error);