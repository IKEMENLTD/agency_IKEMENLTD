# TaskMate AI 流入経路測定システム

営業代理店向けの流入経路測定・管理システムです。LINE友だち追加リンクのトラッキング、コンバージョン測定、手数料管理機能を提供します。

## 機能概要

### 管理者機能
- 代理店の承認・非承認・一時停止管理
- 全体のトラッキングデータ閲覧
- LINE友だち情報の確認
- システム全体の統計情報

### 代理店機能
- トラッキングリンクの作成・管理
- リアルタイム訪問分析
- コンバージョン追跡
- 手数料レポート
- 振込先情報管理

## セットアップ手順

### 1. 環境変数の設定

```bash
cp .env.example .env
```

以下の環境変数を設定してください：

- `SUPABASE_URL`: SupabaseプロジェクトのURL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabaseのサービスロールキー
- `JWT_SECRET`: JWT認証用のシークレットキー（32文字以上）
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging APIのアクセストークン
- `LINE_CHANNEL_SECRET`: LINE Messaging APIのチャネルシークレット

### 2. Supabaseデータベースのセットアップ

1. Supabaseプロジェクトを作成
2. SQLエディタで以下のファイルを実行：
   - `database/schema.sql` - 基本スキーマ
   - `database/create_test_accounts.sql` - テストアカウント（開発時のみ）

### 3. Netlifyへのデプロイ

```bash
# Netlify CLIのインストール
npm install -g netlify-cli

# 依存関係のインストール
npm install

# Netlifyにデプロイ
netlify deploy --prod
```

### 4. Netlify環境変数の設定

Netlify管理画面で以下の環境変数を設定：

1. Site settings → Environment variables
2. `.env`ファイルと同じ環境変数を追加

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