# 請求書自動発行機能 デプロイガイド

## バージョン情報
- **バージョン**: 2.0
- **作成日**: 2025-10-28
- **対応**: インボイス制度・源泉徴収税完全対応

---

## 📋 デプロイチェックリスト

### ✅ 1. データベースマイグレーション

**実行済み**: 2025-10-28

以下のテーブルとオブジェクトが作成されました：

- ✅ `invoices` テーブル（請求書マスター）
- ✅ `invoice_items` テーブル（請求明細）
- ✅ `invoice_sequence` テーブル（請求書番号採番）
- ✅ `agencies` テーブル拡張（インボイス対応カラム追加）
- ✅ `get_next_invoice_number()` 関数（請求書番号自動採番）
- ✅ `set_invoice_retention()` 関数（保存期限自動設定）
- ✅ Row Level Security (RLS) ポリシー

---

### ✅ 2. 日本語フォントセットアップ

**実行済み**: 2025-10-28

- ✅ IPAゴシックフォント (`ipag.ttf`) を `netlify/functions/fonts/` に配置
- ✅ ファイルサイズ: 6.0MB

**注意**: このフォントファイルは以下のいずれかの方法で配置してください：

#### オプション1: Gitにコミット（推奨）
```bash
git add netlify/functions/fonts/ipag.ttf
git commit -m "Add IPA Gothic font for invoice PDF generation"
git push
```

#### オプション2: 手動デプロイ時にアップロード
Netlify管理画面から手動で `netlify/functions/fonts/ipag.ttf` をアップロード

---

### ✅ 3. バックエンドAPI

**作成済み**: 2025-10-28

以下のNetlify Functionsが作成されました：

#### `/netlify/functions/invoice-generate.js`
- **機能**: 請求書生成・PDF作成・メール送信
- **メソッド**: POST
- **認証**: JWT + X-Agency-Id ヘッダー

#### `/netlify/functions/invoice-list.js`
- **機能**: 請求書一覧取得
- **メソッド**: GET
- **認証**: JWT + X-Agency-Id ヘッダー

#### `/netlify/functions/invoice-download.js`
- **機能**: PDF再ダウンロード
- **メソッド**: GET
- **認証**: JWT + X-Agency-Id ヘッダー

#### `/netlify/functions/invoice-resend-email.js`
- **機能**: メール再送信
- **メソッド**: POST
- **認証**: JWT + X-Agency-Id ヘッダー

---

### ✅ 4. フロントエンド実装

**作成済み**: 2025-10-28

#### `agency/dashboard.js`
- ✅ `generateInvoice()` 関数追加
- ✅ `loadInvoices()` 関数追加
- ✅ `downloadInvoice()` 関数追加
- ✅ `resendInvoiceEmail()` 関数追加
- ✅ `getInvoiceStatusLabel()` 関数追加
- ✅ データプロパティ追加: `invoices`, `generatingInvoice`, `invoiceError`, `invoiceSuccess`

#### `agency/index.html`
- ✅ 報酬履歴セクションに「当月請求書発行」ボタン追加
- ✅ 請求書一覧セクション追加（テーブル表示）
- ✅ PDFダウンロード・メール再送信ボタン追加

---

## 🔧 環境変数設定

### 必須環境変数

Netlify管理画面 → Site settings → Environment variables で以下を設定してください：

#### **SENDGRID_API_KEY** ⭐ 新規追加
```
SG.xxxxxxxxxxxxxxxxxxxxx
```
- **取得先**: https://app.sendgrid.com/settings/api_keys
- **用途**: 請求書PDFのメール送信

#### **SENDGRID_FROM_EMAIL** ⭐ 新規追加
```
noreply@agency.ikemen.ltd
```
- **用途**: 請求書送信元メールアドレス
- **重要**: SendGridで認証済みドメインまたはメールアドレスを使用すること

### 既存環境変数（確認のみ）

- ✅ `SUPABASE_URL`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`
- ✅ `JWT_SECRET`

---

## 📦 NPMパッケージ

### 新規追加パッケージ

`package.json` に以下が追加されました：

```json
{
  "dependencies": {
    "pdfkit": "^0.14.0"
  }
}
```

### インストール

```bash
npm install
```

---

## 🚀 デプロイ手順

### ステップ1: Gitにコミット

```bash
# 変更ファイルを確認
git status

# 以下のファイルがステージングされていることを確認
# - database/migration_invoice_system.sql
# - netlify/functions/invoice-generate.js
# - netlify/functions/invoice-list.js
# - netlify/functions/invoice-download.js
# - netlify/functions/invoice-resend-email.js
# - netlify/functions/fonts/ipag.ttf
# - agency/dashboard.js
# - agency/index.html
# - package.json
# - .env.example
# - docs/INVOICE_DEPLOYMENT_GUIDE.md

# コミット
git add .
git commit -m "feat: Add invoice auto-generation feature with Japanese tax compliance

- Database migration for invoices, invoice_items, invoice_sequence tables
- Backend APIs: invoice-generate, invoice-list, invoice-download, invoice-resend-email
- Frontend: invoice generation button and invoice list UI
- Japanese font (IPA Gothic) for PDF generation
- Full support for Japanese Invoice System (インボイス制度)
- Withholding tax calculation for individual business owners
- 7-year retention compliance (電子帳簿保存法)"

# プッシュ
git push origin main
```

### ステップ2: Netlify環境変数設定

1. https://app.netlify.com/ にログイン
2. サイトを選択
3. **Site settings** → **Environment variables**
4. 以下を追加：
   - `SENDGRID_API_KEY`
   - `SENDGRID_FROM_EMAIL`
5. **Save** をクリック

### ステップ3: Netlify再デプロイ

```bash
# 方法1: Netlify管理画面から
# Deploys → Trigger deploy → Clear cache and deploy

# 方法2: コマンドラインから
npm run deploy
```

### ステップ4: デプロイ確認

1. デプロイが完了したら、代理店ダッシュボードにアクセス
2. 「報酬」タブを開く
3. 「当月請求書発行」ボタンが表示されることを確認
4. 請求書一覧セクションが表示されることを確認

---

## 🧪 動作テスト

### テスト1: 請求書生成

1. Supabaseで承認済みコミッションを作成：

```sql
-- テスト用コミッション作成
INSERT INTO agency_commissions (
    agency_id,
    service_id,
    period_start,
    period_end,
    total_conversions,
    total_sales,
    commission_rate,
    commission_amount,
    status
) VALUES (
    'YOUR_AGENCY_ID',
    'YOUR_SERVICE_ID',
    '2025-10-01',
    '2025-10-31',
    5,
    50000,
    20.00,
    10000,
    'approved'
);
```

2. 代理店ダッシュボードで「当月請求書発行」ボタンをクリック
3. 確認ダイアログで「OK」をクリック
4. 成功メッセージが表示されることを確認
5. メールを受信することを確認（PDFが添付されていること）

### テスト2: 請求書一覧表示

1. 請求書一覧セクションに発行した請求書が表示されることを確認
2. 請求書番号、発行日、金額、ステータスが正しく表示されることを確認

### テスト3: PDFダウンロード

1. 請求書一覧で「ダウンロード」アイコンをクリック
2. PDFファイルがダウンロードされることを確認
3. PDFを開いて日本語が正しく表示されることを確認

### テスト4: メール再送信

1. 請求書一覧で「メール再送信」アイコンをクリック
2. 確認ダイアログで「OK」をクリック
3. メールが再送信されることを確認

---

## 🐛 トラブルシューティング

### 問題1: PDF生成時に日本語が表示されない

**原因**: IPAゴシックフォントが見つからない

**解決策**:
```bash
# フォントファイルが正しい場所にあることを確認
ls -lh netlify/functions/fonts/ipag.ttf

# ない場合は再ダウンロード
cd netlify/functions/fonts
wget https://moji.or.jp/wp-content/ipafont/IPAfont/ipag00303.zip
unzip ipag00303.zip
mv ipag00303/ipag.ttf .
rm -rf ipag00303 ipag00303.zip
```

### 問題2: メール送信に失敗する

**原因**: SendGrid API設定が不正

**解決策**:
1. Netlify環境変数で `SENDGRID_API_KEY` が正しく設定されているか確認
2. SendGridでAPIキーが有効か確認: https://app.sendgrid.com/settings/api_keys
3. `SENDGRID_FROM_EMAIL` がSendGridで認証済みか確認

### 問題3: 「承認済みのコミッションが見つかりません」エラー

**原因**: 当月に `status='approved'` のコミッションがない

**解決策**:
```sql
-- 当月のコミッションを確認
SELECT * FROM agency_commissions
WHERE agency_id = 'YOUR_AGENCY_ID'
  AND period_start = '2025-10-01'
  AND period_end = '2025-10-31';

-- ステータスを approved に変更
UPDATE agency_commissions
SET status = 'approved'
WHERE id = 'YOUR_COMMISSION_ID';
```

### 問題4: 請求書番号が重複する

**原因**: `invoice_sequence` テーブルの同時アクセス

**解決策**: 正常動作です。`get_next_invoice_number()` 関数は `FOR UPDATE` ロックで排他制御しています。

---

## 📊 データベーススキーマ

### invoices テーブル

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| invoice_number | VARCHAR(50) | 請求書番号（例: INV-202510-00001） |
| invoice_date | DATE | 発行日 |
| payment_due_date | DATE | 支払期限 |
| agency_id | UUID | 代理店ID |
| period_start | DATE | 対象期間開始 |
| period_end | DATE | 対象期間終了 |
| subtotal | DECIMAL(12,2) | 小計 |
| tax_rate | DECIMAL(5,2) | 消費税率（10.00%） |
| tax_amount | DECIMAL(12,2) | 消費税額 |
| withholding_tax_rate | DECIMAL(5,2) | 源泉徴収税率 |
| withholding_tax_amount | DECIMAL(12,2) | 源泉徴収税額 |
| total_amount | DECIMAL(12,2) | 合計金額 |
| status | VARCHAR(50) | ステータス |
| is_qualified_invoice | BOOLEAN | 適格請求書発行事業者 |

### ステータス一覧

| status | 日本語 | 説明 |
|--------|--------|------|
| draft | 下書き | 作成中 |
| issued | 発行済み | PDF生成完了 |
| sent | 送信済み | メール送信完了 |
| paid | 支払済み | 入金確認済み |
| cancelled | キャンセル | 取消 |
| corrected | 訂正済み | 訂正済み |

---

## 🔒 セキュリティ考慮事項

### Row Level Security (RLS)

代理店は自分の請求書のみアクセス可能：

```sql
-- 代理店は自分のデータのみ閲覧
CREATE POLICY "Agencies can view own invoices"
ON invoices FOR SELECT
USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
```

### JWT認証

全てのAPIエンドポイントは以下を要求：
- `Authorization: Bearer <token>` ヘッダー
- `X-Agency-Id: <agency_id>` ヘッダー

### Service Role Key

Netlify Functionsは `SUPABASE_SERVICE_ROLE_KEY` を使用してRLSをバイパスし、代理店IDで直接フィルタリングします。

---

## 📝 法令対応

### インボイス制度（2023年10月施行）

- ✅ 適格請求書発行事業者登録番号 (`invoice_registration_number`)
- ✅ 税率区分表示（10%）
- ✅ 税込金額表示

### 源泉徴収税（所得税法）

- ✅ 個人事業主判定 (`entity_type = 'individual'`)
- ✅ 100万円以下: 10.21%
- ✅ 100万円超過分: 20.42%
- ✅ 切り捨て計算

### 電子帳簿保存法

- ✅ 7年間保存 (`retention_until`)
- ✅ 自動計算（発行日 + 7年）

---

## 🎉 デプロイ完了

すべてのステップが完了したら、請求書自動発行機能が利用可能になります。

代理店は「報酬」タブから1クリックで請求書を発行し、PDFをメールで受け取ることができます。

---

## 📞 サポート

問題が発生した場合は、以下を確認してください：

1. ブラウザのコンソール（F12）でエラーメッセージを確認
2. Netlify Functions のログを確認
3. Supabaseのログを確認
4. このガイドのトラブルシューティングセクションを参照

---

**作成者**: Claude (Anthropic)
**日付**: 2025-10-28
**バージョン**: 2.0
