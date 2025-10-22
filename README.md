# 代理店管理システム（マルチサービス対応）

**マルチサービス型代理店プラットフォーム** - 複数のLINE公式アカウントサービスを1つのダッシュボードで管理

## 🎯 概要

このシステムは、複数のサービス（LINE公式アカウント）の代理店管理を統合的に行うプラットフォームです。

### 対応サービス

1. **TaskMate AI** - AI搭載タスク管理アシスタント
2. **LiteWEB+** - 軽量・高速Webサービスプラットフォーム
3. **IT補助金サポート** - IT補助金申請LINEサポート
4. **ものづくり補助金サポート** - ものづくり補助金申請LINEサポート

## ✨ 主な機能

### 代理店向け機能
- 📊 **統合ダッシュボード** - 全サービスの成果を1つの画面で管理
- 🔗 **トラッキングリンク生成** - サービスごとに計測可能なリンクを作成
- 📈 **リアルタイム統計** - クリック数、コンバージョン、報酬を即座に確認
- 💰 **報酬管理** - サービス別・統合の報酬レポート
- 👥 **リファラルシステム** - 2段階の代理店紹介プログラム
- 🎯 **サービスフィルタリング** - 特定サービスのデータのみ表示

### 管理者機能
- 代理店の承認・非承認・一時停止管理
- 全体のトラッキングデータ閲覧
- LINE友だち情報の確認
- システム全体の統計情報

### システム管理機能
- 🔐 **JWT認証** - セキュアな認証システム
- 📱 **LINE Webhook統合** - 友達追加の自動トラッキング
- 💳 **Stripe決済連携** - サブスク課金の自動管理
- 🔄 **マルチサービス対応** - サービスの追加がDB登録のみで完結
- 🛡️ **セキュリティ対策** - CSRF保護、レート制限、XSS対策

## 🚀 セットアップ手順

### 1. Supabaseデータベース初期化

Supabase SQL Editorで以下を実行：

```sql
-- 1. マルチサービス対応スキーマ作成
\i database/001_create_services_table.sql

-- 2. 初期サービスデータ登録
\i database/002_insert_initial_services.sql
```

**重要**: `002_insert_initial_services.sql` 内のLINE認証情報を実際の値に置き換えてください。

### 2. 環境変数の設定

#### Supabase
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

#### JWT認証
```
JWT_SECRET=your-secret-key-here
```

#### CORS設定
```
ALLOWED_ORIGINS=https://agency.ikemenl.ltd
```

### 3. Netlifyデプロイ

1. Netlifyで新規サイト作成
2. GitHub連携: `IKEMENLTD/agency_IKEMENLTD`
3. ビルド設定:
   ```
   Base directory: (空欄)
   Build command: echo 'Build complete'
   Publish directory: .
   Functions directory: netlify/functions
   ```
4. 環境変数設定（上記参照）
5. デプロイ

### 4. カスタムドメイン設定

- **推奨ドメイン**: `agency.ikemenl.ltd`
- DNS設定: `CNAME` → Netlifyサイト
- SSL証明書: 自動発行

## URL構成

- `/` - メインランディングページ
- `/admin` - 管理者ダッシュボード
- `/agency` - 代理店ダッシュボード
- `/t/{tracking_code}` - トラッキングリダイレクト

## 初回ログイン

### 管理者
- URL: `https://yourdomain.com/admin`
- デフォルト認証は環境変数で設定

### 代理店
1. `/agency`にアクセス
2. 「新規登録」をクリック
3. 必要情報を入力して登録
4. 管理者が承認後、ログイン可能になります

## APIエンドポイント

### 管理者用
- `POST /.netlify/functions/admin-auth` - 管理者認証
- `GET /.netlify/functions/admin-agencies` - 代理店一覧取得
- `POST /.netlify/functions/admin-agencies` - 代理店ステータス更新

### 代理店用
- `POST /.netlify/functions/agency-register` - 新規登録
- `POST /.netlify/functions/agency-auth` - ログイン
- `POST /.netlify/functions/agency-create-link` - リンク作成
- `GET /.netlify/functions/agency-links` - リンク一覧
- `GET /.netlify/functions/agency-stats` - 統計情報

### トラッキング
- `GET /.netlify/functions/tracking-redirect` - リダイレクト処理
- `POST /.netlify/functions/line-webhook` - LINE Webhook

## トラブルシューティング

### ログインできない場合
1. 代理店ステータスが「承認済み」か確認
2. パスワードが正しいか確認
3. 環境変数が正しく設定されているか確認

### トラッキングが動作しない場合
1. トラッキングコードが正しいか確認
2. LINE友だち追加URLが有効か確認
3. Netlify Functionsが正常に動作しているか確認

## セキュリティ注意事項

- 本番環境では必ず強力なJWT_SECRETを使用
- Supabaseのサービスロールキーは絶対に公開しない
- 定期的にパスワードを変更
- HTTPSを必須とする

## サポート

問題が発生した場合は、以下をご確認ください：
1. Netlifyのデプロイログ
2. Supabaseのログ
3. ブラウザのコンソールログ