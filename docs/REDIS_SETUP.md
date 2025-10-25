# Upstash Redis セットアップガイド

## 概要

このシステムはUpstash Redisを使用してサーバーレス環境でのレート制限を実装しています。

## なぜRedisが必要か？

### 問題: メモリベースのレート制限の限界

Netlify Functionsのようなサーバーレス環境では:
- 各リクエストが異なるインスタンスで実行される可能性がある
- メモリは各インスタンス間で共有されない
- インスタンスは使用後に破棄される

**結果**: メモリベースのレート制限は**無効**

### 解決策: Redisベースのレート制限

Redisを使用することで:
- ✅ すべてのインスタンス間で状態を共有
- ✅ 正確なレート制限カウント
- ✅ ブルートフォース攻撃を効果的に防止

## Upstash Redisの選択理由

1. **サーバーレスに最適化**
   - HTTP REST API（持続的な接続不要）
   - グローバルエッジネットワーク
   - 低レイテンシ

2. **無料プラン**
   - 10,000 commands/日
   - 256MB ストレージ
   - 開発・中小規模サイトに十分

3. **簡単なセットアップ**
   - クレジットカード不要（無料プラン）
   - 数分で開始可能

## セットアップ手順

### 1. Upstashアカウント作成

1. https://console.upstash.com/ にアクセス
2. 「Sign Up」をクリック
3. GitHubまたはメールでサインアップ

### 2. Redisデータベース作成

1. Upstashコンソールで「Create Database」をクリック
2. 以下を設定:
   - **Name**: `taskmate-rate-limit`
   - **Type**: `Global` (推奨) または `Regional`
   - **Region**: 最も近いリージョンを選択（例: Tokyo, Tokyo-JP）
   - **Eviction**: `No Eviction` (推奨)

3. 「Create」をクリック

### 3. 認証情報を取得

データベース作成後、以下の情報が表示されます:

```
UPSTASH_REDIS_REST_URL=https://your-region-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**⚠️ 重要**: これらの値は秘密情報です。安全に保管してください。

### 4. Netlifyに環境変数を設定

#### 方法A: Netlify UI

1. https://app.netlify.com にアクセス
2. プロジェクトを選択
3. **Site settings** → **Environment variables**
4. 以下の変数を追加:

   | Key | Value |
   |-----|-------|
   | `UPSTASH_REDIS_REST_URL` | `https://your-region-xxxxx.upstash.io` |
   | `UPSTASH_REDIS_REST_TOKEN` | `AXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |

5. 「Save」をクリック

#### 方法B: Netlify CLI

```bash
netlify env:set UPSTASH_REDIS_REST_URL "https://your-region-xxxxx.upstash.io"
netlify env:set UPSTASH_REDIS_REST_TOKEN "AXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 5. デプロイ

環境変数を設定後、デプロイを再実行:

```bash
npm run deploy
```

または Netlify UI から「Trigger deploy」

## 動作確認

### 1. ログを確認

Netlify Functions ログに以下が表示されればOK:

```
✅ Redis client initialized
✅ Rate limit OK: xxx.xxx.xxx.xxx on /api/xxx (4 remaining)
```

### 2. レート制限をテスト

ログインエンドポイントに5回連続でリクエスト:

```bash
# 1-5回目: 成功
curl -X POST https://your-site.netlify.app/.netlify/functions/agency-auth \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}'

# 6回目: レート制限エラー
# 応答: 429 Too Many Requests
# { "error": "レート制限を超過しました", "retryAfter": 900 }
```

### 3. Upstashダッシュボードで確認

Upstashコンソールの「Data Browser」で:
- `rate_limit:xxx.xxx.xxx.xxx:/api/xxx` というキーが表示される
- カウント値を確認できる

## トラブルシューティング

### Redisに接続できない

**症状**: ログに以下が表示される
```
⚠️  UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured
⚠️  Falling back to memory-based rate limiting
```

**解決策**:
1. Netlify環境変数が正しく設定されているか確認
2. 変数名のスペルミスがないか確認
3. デプロイを再実行

### Redisエラーが発生する

**症状**: ログに以下が表示される
```
❌ Redis rate limit check failed: ...
⚠️  Allowing request due to Redis error (fail-open)
```

**解決策**:
1. Upstash RedisのURLとトークンが正しいか確認
2. Upstashのステータスページを確認: https://status.upstash.com/
3. Upstashの無料プランの上限（10,000 commands/日）を超えていないか確認

### レート制限が機能しない

**確認項目**:
1. 環境変数が設定されているか
2. Redisクライアントが初期化されているか（ログ確認）
3. 異なるIPアドレスから送信していないか

## コスト

### 無料プラン
- **コマンド数**: 10,000/日
- **ストレージ**: 256MB
- **リージョン**: グローバル
- **サポート**: コミュニティ

**推定使用量**:
- 1ユーザーあたり 5-10 commands/日
- 無料プランで 1,000-2,000 アクティブユーザー/日 をカバー可能

### 有料プラン（必要に応じて）
- **Pay as you go**: $0.2/100K commands
- **Pro 200K**: $10/月（200K commands含む）

詳細: https://upstash.com/pricing

## セキュリティ

### ベストプラクティス

1. **環境変数を安全に保管**
   - `.env` ファイルは `.gitignore` に追加
   - トークンをコードに直接埋め込まない
   - Netlify環境変数のみで管理

2. **トークンのローテーション**
   - 定期的にトークンを再生成（Upstashコンソールから可能）
   - 古いトークンを無効化

3. **アクセス制限**
   - Upstashの「IP Allow List」機能を使用（有料プラン）
   - Netlifyの静的IPアドレスのみ許可

## 参考リンク

- [Upstash Documentation](https://docs.upstash.com/)
- [Upstash Redis REST API](https://docs.upstash.com/redis/features/restapi)
- [Netlify Environment Variables](https://docs.netlify.com/configure-builds/environment-variables/)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)

## サポート

問題が発生した場合:
1. Upstashコミュニティ: https://discord.gg/upstash
2. Upstashドキュメント: https://docs.upstash.com/
3. 本プロジェクトのIssue: [GitHub Issues]
