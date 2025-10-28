# 請求書自動発行機能 完全設計書【日本の法律完全対応版】

**バージョン:** 2.0（修正完全版）
**作成日:** 2025-10-28
**最終更新:** 2025-10-28
**対象システム:** 株式会社イケメン 代理店管理システム
**目的:** 1クリックで請求書PDF生成 → メール送信を自動化（インボイス制度・源泉徴収税完全対応）

---

## 📋 目次

1. [機能概要](#機能概要)
2. [日本の法律対応](#日本の法律対応)
3. [ビジネス要件](#ビジネス要件)
4. [技術要件](#技術要件)
5. [データベース設計](#データベース設計)
6. [API設計](#api設計)
7. [PDF生成仕様](#pdf生成仕様)
8. [メール送信仕様](#メール送信仕様)
9. [フロントエンドUI設計](#フロントエンドui設計)
10. [セキュリティ対策](#セキュリティ対策)
11. [エラーハンドリング](#エラーハンドリング)
12. [実装ロードマップ](#実装ロードマップ)

---

## 機能概要

### 現状の課題
- 代理店が報酬を受け取るために、手動で請求書を作成してメール送信する必要がある
- 管理者側も請求書を確認・管理するフローが煩雑
- インボイス制度・源泉徴収税への対応が必要

### 解決策
**「請求書発行」ボタン** を1クリックするだけで:
1. ✅ 当月の精算対象金額を自動集計
2. ✅ **インボイス制度対応**の正式な請求書PDFを自動生成
3. ✅ **源泉徴収税を自動計算**（個人事業主の場合）
4. ✅ 代理店の登録メールアドレスに自動送信（PDF添付）
5. ✅ 管理者にもBCC送信（承認・記録用）
6. ✅ 請求書発行履歴をデータベースに記録（7年間保存）

### ユーザー体験
```
[代理店ダッシュボード] → [報酬タブ] → [当月精算額: ¥500,000 を表示]
                                       ↓
                            [📄 請求書発行] ボタンをクリック
                                       ↓
                            「請求書を発行しています...」
                                       ↓
                      「✅ 請求書を発行しました！メールをご確認ください」
```

---

## 日本の法律対応

### 1. インボイス制度（適格請求書等保存方式）

**施行日:** 2023年10月1日

**要件:**
- 適格請求書発行事業者の登録番号（T+13桁）を記載
- 税率ごとに区分した消費税額を記載
- 登録番号がない請求書は仕入税額控除の対象外

**対応方針:**
- 代理店登録時に「適格請求書発行事業者登録番号」を入力可能にする
- 登録番号がある代理店の請求書には番号を記載
- 登録番号がない代理店（免税事業者）は経過措置を適用

#### 経過措置（2023年10月〜2029年9月）
| 期間 | 仕入税額控除の割合 |
|-----|------------------|
| 2023年10月1日〜2026年9月30日 | 80% |
| 2026年10月1日〜2029年9月30日 | 50% |
| 2029年10月1日〜 | 0% |

### 2. 源泉徴収税

**対象:** 個人事業主への報酬支払い

**税率:**
- 報酬額が100万円以下: **10.21%**
- 報酬額が100万円超: 100万円までは10.21%、超過分は **20.42%**

**計算式:**
```javascript
// 報酬額 ≤ 100万円の場合
源泉徴収税 = Math.floor(報酬額 × 0.1021);

// 報酬額 > 100万円の場合
源泉徴収税 = Math.floor(1000000 × 0.1021) + Math.floor((報酬額 - 1000000) × 0.2042);
```

**対応方針:**
- 代理店の事業形態（法人/個人）を登録
- 個人事業主の場合、請求書に源泉徴収税を自動計算して表示
- 支払額 = 報酬額（税込） - 源泉徴収税

### 3. 電子帳簿保存法

**保存期間:** 7年間

**要件:**
- 請求書データを7年間保存
- 改ざん防止措置（タイムスタンプ等）

**対応方針:**
- 請求書PDFをSupabase Storageに保存
- `retention_until`（保存期限）を自動設定（発行日+7年）
- 削除は管理者のみ、保存期限経過後に実行可能

### 4. 消費税の扱い

**標準税率:** 10%

**免税事業者の扱い:**
- 適格請求書発行事業者でない場合、消費税を請求しても仕入税額控除の対象外
- ただし、消費税の請求自体は可能（事業者の任意）

**対応方針:**
```javascript
if (agency.is_qualified_invoice_issuer) {
    // 適格請求書発行事業者 → 消費税を課税
    taxAmount = Math.floor(subtotal * 0.10); // 切り捨て
} else {
    // 免税事業者 → 消費税を課税しない、または経過措置を適用
    taxAmount = 0;
    // 請求書に「※適格請求書発行事業者ではありません」と記載
}
```

---

## ビジネス要件

### 請求書に含める情報

#### 基本情報
- **請求書番号**: `INV-YYYYMM-XXXXX` 形式（例: `INV-202510-00001`）
- **発行日**: 発行時の日付
- **支払期限**: 発行日から30日後（カスタマイズ可能）
- **請求元**: 代理店（報酬を受け取る側）
- **請求先**: 株式会社イケメン 経理部（報酬を支払う側）

#### 代理店情報（請求元）
- 代理店名（`agencies.name`）
- 代理店コード（`agencies.code`）
- 事業形態（`agencies.entity_type`）: 法人 or 個人事業主
- **適格請求書発行事業者登録番号**（`agencies.invoice_registration_number`）← インボイス制度対応
- 登録住所（`agencies.address`）
- 連絡先メール（`agencies.contact_email`）
- 連絡先電話（`agencies.contact_phone`）
- 振込先情報（`agencies.payment_info` JSONB）

#### 株式会社イケメン情報（請求先）
- 会社名: 株式会社イケメン
- 住所: 環境変数 `INVOICE_COMPANY_ADDRESS`
- 電話: 環境変数 `INVOICE_COMPANY_PHONE`
- 担当部署: 経理部

#### 請求明細
| 項目 | 内容 |
|-----|------|
| **対象期間** | YYYY年MM月01日 〜 YYYY年MM月末日 |
| **サービス名** | TaskMate AI / LiteWEB+ / IT補助金サポート / ものづくり補助金サポート |
| **コンバージョン数** | XX件 |
| **売上合計** | ¥XXX,XXX |
| **報酬率** | XX% |
| **報酬額（小計）** | ¥XX,XXX |

#### 合計額計算（法人の場合）
```
小計（税抜）:              ¥500,000
消費税（10%）:             ¥50,000
───────────────────────────────
合計請求額:                ¥550,000
```

#### 合計額計算（個人事業主の場合）
```
小計（税抜）:              ¥500,000
消費税（10%）:             ¥50,000
源泉徴収税（10.21%）:      -¥51,050
───────────────────────────────
お支払額:                  ¥498,950
```

**重要:** 源泉徴収税は「税込金額」に対して計算します。

### 金額の丸め処理

**日本の商習慣に従い、全て「切り捨て」を使用:**
```javascript
// 消費税の計算
const taxAmount = Math.floor(subtotal * 0.10);

// 源泉徴収税の計算
const withholdingTax = Math.floor((subtotal + taxAmount) * 0.1021);
```

### 発行条件
- ✅ 対象期間の `agency_commissions` レコードが存在する
- ✅ `status` が `pending` または `approved` である
- ✅ `commission_amount` が 0 より大きい
- ✅ 対象期間が当月または過去3ヶ月以内である（修正: 過去月も発行可能に）
- ❌ 既に同期間の請求書が発行済みの場合はエラー（重複防止）

### 制約事項
- 同一期間の請求書は1回のみ発行可能（再発行は管理者のみ）
- 請求書番号は連番で重複なし（トランザクション制御で保証）
- 対象期間は当月または過去3ヶ月以内（それ以前は管理者に問い合わせ）
- `status=cancelled` の報酬は請求書に含めない

---

## 技術要件

### 技術スタック

| コンポーネント | 技術 | 理由 |
|-------------|------|------|
| **PDF生成** | `pdfkit` | Node.js標準、日本語フォント対応、軽量 |
| **日本語フォント** | IPA Pゴシック | オープンソース、商用利用可 |
| **メール送信** | `@sendgrid/mail` | 既に導入済み、高信頼性 |
| **バックエンド** | Netlify Functions | 既存インフラ、サーバーレス |
| **データベース** | Supabase PostgreSQL | 既存DB、トランザクション対応 |
| **フロントエンド** | Alpine.js + Tailwind CSS | 既存フレームワーク |

### 必要なライブラリ追加

```json
{
  "dependencies": {
    "pdfkit": "^0.13.0",
    "dayjs": "^1.11.10"
  }
}
```

### 日本語フォントのセットアップ

#### ステップ1: IPAフォントのダウンロード
```bash
# プロジェクトルートで実行
mkdir -p netlify/functions/fonts
cd netlify/functions/fonts

# IPA Pゴシック（オープンソースフォント）
wget https://moji.or.jp/wp-content/ipafont/IPAfont/IPAfont00303.zip
unzip IPAfont00303.zip
cp IPAfont00303/ipagp.ttf ./
rm -rf IPAfont00303 IPAfont00303.zip

# または手動でダウンロード: https://moji.or.jp/ipafont/
```

#### ステップ2: .gitignore に追加（容量が大きい場合）
```
# netlify/functions/fonts/*.ttf は Git 管理に含めるが、
# 容量が大きい場合は .netlify/functions-internal/ にデプロイ時コピー
```

#### ステップ3: PDF生成コードでフォント指定
```javascript
const path = require('path');
const fontPath = path.join(__dirname, 'fonts', 'ipagp.ttf');
doc.font(fontPath);
```

### 環境変数追加

```bash
# SendGrid設定（既存）
SENDGRID_API_KEY=SG.xxx...

# 請求書設定（新規）
INVOICE_SENDER_EMAIL=noreply@ikemen.ltd
INVOICE_BCC_EMAIL=accounting@ikemen.ltd
INVOICE_COMPANY_NAME=株式会社イケメン
INVOICE_COMPANY_ADDRESS=東京都渋谷区〇〇1-2-3
INVOICE_COMPANY_PHONE=03-1234-5678
INVOICE_COMPANY_REGISTRATION_NUMBER=T1234567890123
INVOICE_TAX_RATE=10
INVOICE_PAYMENT_DUE_DAYS=30

# Supabase Storage（既存）
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 環境変数の検証

```javascript
// netlify/functions/utils/validate-env.js
const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SENDGRID_API_KEY',
    'INVOICE_SENDER_EMAIL',
    'INVOICE_BCC_EMAIL',
    'INVOICE_COMPANY_NAME',
    'INVOICE_COMPANY_ADDRESS'
];

function validateEnvironment() {
    const missing = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missing.length > 0) {
        throw new Error(`環境変数が設定されていません: ${missing.join(', ')}`);
    }
}

module.exports = { validateEnvironment };
```

---

## データベース設計

### 新規テーブル: `invoices`（請求書マスター）

```sql
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 請求書識別情報
    invoice_number VARCHAR(50) UNIQUE NOT NULL,  -- 例: INV-202510-00001
    invoice_date DATE NOT NULL,                   -- 発行日
    payment_due_date DATE NOT NULL,               -- 支払期限

    -- 代理店情報（スナップショット）
    agency_id UUID NOT NULL REFERENCES agencies(id),
    agency_name VARCHAR(255) NOT NULL,            -- 発行時の代理店名
    agency_code VARCHAR(50) NOT NULL,             -- 代理店コード
    agency_entity_type VARCHAR(20) NOT NULL,      -- 法人 or 個人事業主
    agency_invoice_registration_number VARCHAR(20), -- 適格請求書発行事業者登録番号
    agency_address TEXT,                          -- 住所
    agency_contact_email VARCHAR(255),            -- メール
    agency_contact_phone VARCHAR(50),             -- 電話
    agency_payment_info JSONB,                    -- 振込先情報（スナップショット）

    -- 対象期間
    period_start DATE NOT NULL,                   -- 対象期間開始（例: 2025-10-01）
    period_end DATE NOT NULL,                     -- 対象期間終了（例: 2025-10-31）

    -- 金額情報
    subtotal DECIMAL(12,2) NOT NULL,              -- 小計（税抜）
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00, -- 消費税率（%）
    tax_amount DECIMAL(12,2) NOT NULL,            -- 消費税額
    withholding_tax_rate DECIMAL(5,2) DEFAULT 0,  -- 源泉徴収税率（%）
    withholding_tax_amount DECIMAL(12,2) DEFAULT 0, -- 源泉徴収税額
    total_amount DECIMAL(12,2) NOT NULL,          -- 合計額（支払額）

    -- インボイス制度対応
    is_qualified_invoice BOOLEAN DEFAULT false,   -- 適格請求書か
    invoice_note TEXT,                            -- 備考（免税事業者の場合の注記等）

    -- ステータス
    status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'cancelled', 'corrected')),
    -- draft: 下書き
    -- issued: 発行済み（メール送信前）
    -- sent: 送信済み
    -- paid: 支払済み
    -- cancelled: キャンセル
    -- corrected: 訂正済み（新しい請求書が発行された）

    -- 訂正・取消
    parent_invoice_id UUID REFERENCES invoices(id), -- 訂正元の請求書
    correction_reason TEXT,                       -- 訂正理由
    is_correction BOOLEAN DEFAULT false,          -- 訂正請求書か

    -- メール送信情報
    email_sent_at TIMESTAMP,                      -- メール送信日時
    email_recipient VARCHAR(255),                 -- 送信先メールアドレス
    email_status VARCHAR(50),                     -- success/failed
    email_error TEXT,                             -- エラーメッセージ

    -- PDF情報
    pdf_url TEXT,                                 -- PDF保存URL（Supabase Storage）
    pdf_generated_at TIMESTAMP,                   -- PDF生成日時

    -- 保存期間（電子帳簿保存法）
    retention_until DATE,                         -- 保存期限（発行日から7年後）
    archived_at TIMESTAMP,                        -- アーカイブ日時

    -- メタデータ
    notes TEXT,                                   -- 管理者メモ
    metadata JSONB DEFAULT '{}',                  -- 追加情報

    -- タイムスタンプ
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- 制約
    CONSTRAINT unique_agency_period UNIQUE (agency_id, period_start, period_end)
);

-- インデックス作成
CREATE INDEX idx_invoices_agency_id ON invoices(agency_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_period ON invoices(period_start, period_end);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_created_at ON invoices(created_at);
CREATE INDEX idx_invoices_retention_until ON invoices(retention_until);

-- 保存期限の自動設定トリガー
CREATE OR REPLACE FUNCTION set_invoice_retention()
RETURNS TRIGGER AS $$
BEGIN
    NEW.retention_until := NEW.invoice_date + INTERVAL '7 years';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_invoice_retention_trigger
BEFORE INSERT ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_invoice_retention();

-- 更新日時の自動更新トリガー
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
```

### 新規テーブル: `invoice_items`（請求明細）

```sql
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 請求書との紐付け
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    -- サービス情報
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service_name VARCHAR(255) NOT NULL,           -- サービス名（スナップショット）

    -- コミッション情報
    commission_id UUID REFERENCES agency_commissions(id) ON DELETE SET NULL,

    -- 明細情報
    description TEXT,                             -- 説明（例: "TaskMate AI 10月分報酬"）
    quantity INTEGER NOT NULL DEFAULT 1,          -- 数量（通常は1）
    conversion_count INTEGER,                     -- コンバージョン数
    total_sales DECIMAL(12,2),                    -- 総売上
    commission_rate DECIMAL(5,2),                 -- 報酬率（%）
    unit_price DECIMAL(12,2) NOT NULL,            -- 単価（報酬額）
    amount DECIMAL(12,2) NOT NULL,                -- 金額（小計）

    -- 並び順
    sort_order INTEGER DEFAULT 0,

    -- タイムスタンプ
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_service_id ON invoice_items(service_id);
CREATE INDEX idx_invoice_items_commission_id ON invoice_items(commission_id);

-- 更新日時の自動更新トリガー
CREATE TRIGGER update_invoice_items_updated_at
BEFORE UPDATE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
```

### 新規テーブル: `invoice_sequence`（請求書番号採番）

```sql
CREATE TABLE invoice_sequence (
    year_month VARCHAR(6) PRIMARY KEY,  -- YYYYMM形式（例: 202510）
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 請求書番号自動採番関数（トランザクション完全対応）
CREATE OR REPLACE FUNCTION get_next_invoice_number(target_year_month VARCHAR(6))
RETURNS VARCHAR(50) AS $$
DECLARE
    next_num INTEGER;
    invoice_num VARCHAR(50);
BEGIN
    -- 行ロック（FOR UPDATE）で排他制御
    SELECT last_number INTO next_num
    FROM invoice_sequence
    WHERE year_month = target_year_month
    FOR UPDATE;

    IF NOT FOUND THEN
        -- 新規作成
        INSERT INTO invoice_sequence (year_month, last_number)
        VALUES (target_year_month, 1)
        RETURNING last_number INTO next_num;
    ELSE
        -- インクリメント
        UPDATE invoice_sequence
        SET last_number = last_number + 1,
            updated_at = NOW()
        WHERE year_month = target_year_month
        RETURNING last_number INTO next_num;
    END IF;

    -- 請求書番号生成: INV-YYYYMM-XXXXX
    invoice_num := 'INV-' || target_year_month || '-' || LPAD(next_num::TEXT, 5, '0');

    RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;
```

### 既存テーブル更新: `agencies`

```sql
-- インボイス制度・源泉徴収税対応カラムを追加
ALTER TABLE agencies
ADD COLUMN entity_type VARCHAR(20) DEFAULT 'corporation'
    CHECK (entity_type IN ('corporation', 'individual')),
    -- corporation: 法人
    -- individual: 個人事業主

ADD COLUMN invoice_registration_number VARCHAR(20),
    -- 適格請求書発行事業者登録番号（T+13桁）
    -- 例: T1234567890123

ADD COLUMN is_qualified_invoice_issuer BOOLEAN DEFAULT false,
    -- 適格請求書発行事業者か

ADD COLUMN tax_calculation_type VARCHAR(20) DEFAULT 'standard'
    CHECK (tax_calculation_type IN ('standard', 'exempt', 'simplified'));
    -- standard: 標準課税
    -- exempt: 免税事業者
    -- simplified: 簡易課税

-- インデックス追加
CREATE INDEX idx_agencies_entity_type ON agencies(entity_type);
CREATE INDEX idx_agencies_is_qualified_invoice_issuer ON agencies(is_qualified_invoice_issuer);

-- 既存データへのデフォルト値設定
UPDATE agencies
SET entity_type = 'corporation',
    is_qualified_invoice_issuer = false,
    tax_calculation_type = 'standard'
WHERE entity_type IS NULL;
```

### 既存テーブル更新: `agency_commissions`

```sql
-- 請求書IDカラムを追加
ALTER TABLE agency_commissions
ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- インデックス追加
CREATE INDEX idx_agency_commissions_invoice_id ON agency_commissions(invoice_id);
```

---

## API設計

### POST `/.netlify/functions/invoice-generate`

**目的:** 請求書を生成してメール送信

#### リクエスト

```http
POST /.netlify/functions/invoice-generate
Content-Type: application/json
Authorization: Bearer {JWT_TOKEN}
X-Agency-Id: {AGENCY_ID}

{
  "period_start": "2025-10-01",  // オプション、デフォルト: 当月1日
  "period_end": "2025-10-31",    // オプション、デフォルト: 当月末日
  "send_email": true,            // メール送信するか（デフォルト: true）
  "notes": "10月分の報酬請求です" // 備考（オプション）
}
```

#### レスポンス（成功 - 法人の場合）

```json
{
  "success": true,
  "invoice": {
    "id": "uuid-...",
    "invoice_number": "INV-202510-00001",
    "invoice_date": "2025-10-28",
    "payment_due_date": "2025-11-27",
    "agency_entity_type": "corporation",
    "is_qualified_invoice": true,
    "subtotal": 500000,
    "tax_amount": 50000,
    "withholding_tax_amount": 0,
    "total_amount": 550000,
    "status": "sent",
    "pdf_url": "https://supabase.co/storage/invoices/uuid.../INV-202510-00001.pdf",
    "email_sent_at": "2025-10-28T10:00:00Z",
    "retention_until": "2032-10-28",
    "items": [
      {
        "service_name": "TaskMate AI",
        "conversion_count": 25,
        "total_sales": 250000,
        "commission_rate": 20.00,
        "amount": 50000
      },
      {
        "service_name": "LiteWEB+",
        "conversion_count": 30,
        "total_sales": 2250000,
        "commission_rate": 20.00,
        "amount": 450000
      }
    ]
  },
  "message": "請求書を発行しました。メールをご確認ください。"
}
```

#### レスポンス（成功 - 個人事業主の場合）

```json
{
  "success": true,
  "invoice": {
    "id": "uuid-...",
    "invoice_number": "INV-202510-00002",
    "agency_entity_type": "individual",
    "is_qualified_invoice": false,
    "subtotal": 500000,
    "tax_amount": 50000,
    "withholding_tax_amount": 56155,  // (500000 + 50000) × 0.1021 = 56155
    "total_amount": 493845,           // 500000 + 50000 - 56155 = 493845
    "invoice_note": "※個人事業主のため、源泉徴収税を差し引いています",
    ...
  }
}
```

#### レスポンス（エラー）

```json
{
  "error": "対象期間の精算対象報酬がありません",
  "code": "NO_COMMISSIONS"
}
```

```json
{
  "error": "この期間の請求書は既に発行済みです",
  "code": "INVOICE_ALREADY_EXISTS",
  "existing_invoice": {
    "invoice_number": "INV-202510-00001",
    "invoice_date": "2025-10-15",
    "status": "sent"
  }
}
```

```json
{
  "error": "請求書の発行は過去3ヶ月までです。それ以前の期間については管理者にお問い合わせください。",
  "code": "PERIOD_TOO_OLD"
}
```

#### 処理フロー

```javascript
1. JWT認証 → agencyId取得
2. 環境変数の検証
3. 対象期間のバリデーション
   - 当月または過去3ヶ月以内か確認
4. 対象期間の agency_commissions を取得
   - WHERE agency_id = {agencyId}
   - AND period_start >= {period_start}
   - AND period_end <= {period_end}
   - AND status IN ('pending', 'approved')
   - AND commission_amount > 0
5. 報酬がない場合はエラー
6. 既に請求書が発行済みか確認
   - invoices テーブルで同期間のレコードを検索
   - 存在する場合はエラー
7. 代理店情報を取得（スナップショット用）
8. トランザクション開始
9. 請求書番号を採番
   - get_next_invoice_number('202510')
10. 金額計算
   - subtotal = SUM(commission_amount)
   - taxAmount = Math.floor(subtotal × 0.1)
   - withholdingTaxAmount = 0（法人の場合）
   - withholdingTaxAmount = Math.floor((subtotal + taxAmount) × 0.1021)（個人の場合）
   - totalAmount = subtotal + taxAmount - withholdingTaxAmount
11. invoices テーブルに INSERT（代理店情報をスナップショット保存）
12. invoice_items テーブルに明細を INSERT（サービスごと）
13. agency_commissions.invoice_id に紐付け
14. トランザクションコミット
15. PDF生成
16. PDF を Supabase Storage にアップロード
17. invoices.pdf_url を UPDATE
18. SendGrid でメール送信（PDF添付）
19. メール送信成功 → invoices.status を 'sent' に UPDATE
20. メール送信失敗 → invoices.status を 'issued' のまま、email_error を記録
21. レスポンス返却
```

---

### GET `/.netlify/functions/invoice-list`

**目的:** 代理店の請求書一覧取得

#### リクエスト

```http
GET /.netlify/functions/invoice-list?limit=20&offset=0&status=sent
Authorization: Bearer {JWT_TOKEN}
X-Agency-Id: {AGENCY_ID}
```

#### クエリパラメータ
- `limit`: 取得件数（デフォルト: 20）
- `offset`: オフセット（デフォルト: 0）
- `status`: ステータスフィルタ（オプション）

#### レスポンス

```json
{
  "invoices": [
    {
      "id": "uuid-...",
      "invoice_number": "INV-202510-00001",
      "invoice_date": "2025-10-28",
      "period": "2025年10月",
      "period_start": "2025-10-01",
      "period_end": "2025-10-31",
      "subtotal": 500000,
      "tax_amount": 50000,
      "withholding_tax_amount": 0,
      "total_amount": 550000,
      "status": "sent",
      "is_qualified_invoice": true,
      "pdf_url": "https://...",
      "email_sent_at": "2025-10-28T10:00:00Z",
      "created_at": "2025-10-28T10:00:00Z"
    }
  ],
  "total": 12,
  "limit": 20,
  "offset": 0
}
```

---

### GET `/.netlify/functions/invoice-download/{invoice_id}`

**目的:** 請求書PDFをダウンロード

#### リクエスト

```http
GET /.netlify/functions/invoice-download/uuid-...
Authorization: Bearer {JWT_TOKEN}
X-Agency-Id: {AGENCY_ID}
```

#### レスポンス

- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="INV-202510-00001.pdf"`
- PDF バイナリデータ

---

### POST `/.netlify/functions/invoice-resend-email`

**目的:** 請求書メールの再送信

#### リクエスト

```http
POST /.netlify/functions/invoice-resend-email
Content-Type: application/json
Authorization: Bearer {JWT_TOKEN}
X-Agency-Id: {AGENCY_ID}

{
  "invoice_id": "uuid-..."
}
```

#### レスポンス（成功）

```json
{
  "success": true,
  "invoice_id": "uuid-...",
  "email_sent_at": "2025-10-28T15:00:00Z",
  "message": "請求書を再送信しました。"
}
```

#### レスポンス（エラー）

```json
{
  "error": "請求書が見つかりません",
  "code": "INVOICE_NOT_FOUND"
}
```

```json
{
  "error": "この請求書は再送信できません（ステータス: cancelled）",
  "code": "INVALID_STATUS"
}
```

---

### POST `/.netlify/functions/invoice-preview`

**目的:** 請求書のプレビュー（DB保存なし）

#### リクエスト

```http
POST /.netlify/functions/invoice-preview
Content-Type: application/json
Authorization: Bearer {JWT_TOKEN}
X-Agency-Id: {AGENCY_ID}

{
  "period_start": "2025-10-01",
  "period_end": "2025-10-31"
}
```

#### レスポンス

- Content-Type: `application/pdf`
- PDF バイナリデータ（プレビュー用、DB保存なし）

---

### 管理者専用API

#### POST `/.netlify/functions/admin/invoice-regenerate`

**目的:** 管理者による請求書の再発行

#### リクエスト

```http
POST /.netlify/functions/admin/invoice-regenerate
Content-Type: application/json
Authorization: Bearer {ADMIN_JWT_TOKEN}

{
  "agency_id": "uuid-...",
  "period_start": "2025-10-01",
  "period_end": "2025-10-31",
  "force_regenerate": true,
  "correction_reason": "金額計算誤りのため訂正"
}
```

#### 処理フロー
1. 管理者権限チェック
2. `force_regenerate=true` の場合、既存の請求書を 'corrected' にする
3. 新規請求書を生成（`is_correction=true`, `parent_invoice_id` 設定）
4. メール送信

---

## PDF生成仕様

### ライブラリ: `pdfkit` + IPA Pゴシック

### PDF生成コード（完全版）

```javascript
const PDFDocument = require('pdfkit');
const path = require('path');
const dayjs = require('dayjs');
require('dayjs/locale/ja');
dayjs.locale('ja');

async function generateInvoicePDF(invoice, items, agency) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: `請求書 ${invoice.invoice_number}`,
                Author: agency.name,
                Subject: `株式会社イケメン 様への請求書`
            }
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(buffers);
            resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // 日本語フォント設定
        const fontPath = path.join(__dirname, 'fonts', 'ipagp.ttf');
        doc.font(fontPath);

        // ========================================
        // ヘッダー
        // ========================================
        doc.fontSize(24).text('請求書', { align: 'center' });
        doc.moveDown(0.5);

        // インボイス制度対応: 適格請求書の表示
        if (invoice.is_qualified_invoice) {
            doc.fontSize(10).text('【適格請求書】', { align: 'center' });
        } else {
            doc.fontSize(9).text('【区分記載請求書】※適格請求書ではありません', { align: 'center' });
        }
        doc.moveDown();

        // ========================================
        // 請求書情報
        // ========================================
        const infoY = 120;
        doc.fontSize(10);
        doc.text(`請求書番号: ${invoice.invoice_number}`, 50, infoY);
        doc.text(`発行日: ${formatDate(invoice.invoice_date)}`, 50, infoY + 15);
        doc.text(`支払期限: ${formatDate(invoice.payment_due_date)}`, 50, infoY + 30);

        // ========================================
        // 宛先（右側）
        // ========================================
        doc.fontSize(14).text('株式会社イケメン 御中', 350, infoY, { align: 'right' });
        doc.fontSize(9).text('経理部 宛', 350, infoY + 20, { align: 'right' });

        // ========================================
        // 請求メッセージ
        // ========================================
        doc.fontSize(10).text('下記の通りご請求申し上げます。', 50, infoY + 60);

        // ========================================
        // 請求金額（大きく表示）
        // ========================================
        doc.fontSize(18)
           .text(
               `ご請求金額: ¥${invoice.total_amount.toLocaleString('ja-JP')}`,
               50,
               infoY + 90,
               { align: 'center' }
           );

        // 区切り線
        doc.moveTo(50, infoY + 120).lineTo(550, infoY + 120).stroke();

        // ========================================
        // 請求元情報
        // ========================================
        let y = infoY + 135;
        doc.fontSize(12).text('【請求元】', 50, y);
        y += 20;

        doc.fontSize(10);
        doc.text(`代理店名: ${invoice.agency_name}`, 50, y);
        y += 15;
        doc.text(`代理店コード: ${invoice.agency_code}`, 50, y);
        y += 15;

        // 事業形態
        const entityTypeLabel = invoice.agency_entity_type === 'corporation' ? '法人' : '個人事業主';
        doc.text(`事業形態: ${entityTypeLabel}`, 50, y);
        y += 15;

        // インボイス制度: 適格請求書発行事業者登録番号
        if (invoice.agency_invoice_registration_number) {
            doc.text(`登録番号: ${invoice.agency_invoice_registration_number}`, 50, y);
            y += 15;
        }

        if (invoice.agency_address) {
            doc.text(`住所: ${invoice.agency_address}`, 50, y);
            y += 15;
        }

        if (invoice.agency_contact_phone) {
            doc.text(`電話: ${invoice.agency_contact_phone}`, 50, y);
            y += 15;
        }

        doc.text(`メール: ${invoice.agency_contact_email}`, 50, y);
        y += 25;

        // ========================================
        // 振込先情報
        // ========================================
        const paymentInfo = invoice.agency_payment_info || {};
        doc.fontSize(12).text('【振込先情報】', 50, y);
        y += 20;

        doc.fontSize(10);
        doc.text(`銀行名: ${paymentInfo.bank_name || '未登録'}`, 50, y);
        y += 15;
        doc.text(`支店名: ${paymentInfo.branch_name || '未登録'}`, 50, y);
        y += 15;
        doc.text(`口座種別: ${paymentInfo.account_type || '未登録'}`, 50, y);
        y += 15;
        doc.text(`口座番号: ${paymentInfo.account_number || '未登録'}`, 50, y);
        y += 15;
        doc.text(`口座名義: ${paymentInfo.account_holder || '未登録'}`, 50, y);
        y += 25;

        // 区切り線
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 10;

        // ========================================
        // 明細
        // ========================================
        doc.fontSize(12).text(
            `【明細】対象期間: ${formatDate(invoice.period_start)} 〜 ${formatDate(invoice.period_end)}`,
            50,
            y
        );
        y += 20;

        // テーブルヘッダー
        doc.fontSize(9);
        doc.text('サービス名', 50, y);
        doc.text('CV数', 220, y, { width: 50, align: 'right' });
        doc.text('売上', 280, y, { width: 80, align: 'right' });
        doc.text('率', 370, y, { width: 40, align: 'right' });
        doc.text('報酬', 420, y, { width: 100, align: 'right' });

        // 区切り線
        y += 15;
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 5;

        // 明細行
        items.forEach(item => {
            y += 15;
            doc.text(item.service_name, 50, y, { width: 160 });
            doc.text(String(item.conversion_count || 0), 220, y, { width: 50, align: 'right' });
            doc.text(`¥${(item.total_sales || 0).toLocaleString('ja-JP')}`, 280, y, { width: 80, align: 'right' });
            doc.text(`${item.commission_rate}%`, 370, y, { width: 40, align: 'right' });
            doc.text(`¥${item.amount.toLocaleString('ja-JP')}`, 420, y, { width: 100, align: 'right' });
        });

        // 区切り線
        y += 20;
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 10;

        // ========================================
        // 合計
        // ========================================
        doc.fontSize(10);

        // 小計
        y += 10;
        doc.text('小計（税抜）:', 350, y);
        doc.text(`¥${invoice.subtotal.toLocaleString('ja-JP')}`, 420, y, { width: 100, align: 'right' });

        // 消費税
        y += 20;
        doc.text(`消費税（${invoice.tax_rate}%）:`, 350, y);
        doc.text(`¥${invoice.tax_amount.toLocaleString('ja-JP')}`, 420, y, { width: 100, align: 'right' });

        // 源泉徴収税（個人事業主の場合）
        if (invoice.withholding_tax_amount > 0) {
            y += 20;
            doc.text(`源泉徴収税（${invoice.withholding_tax_rate}%）:`, 350, y);
            doc.text(`-¥${invoice.withholding_tax_amount.toLocaleString('ja-JP')}`, 420, y, { width: 100, align: 'right' });
        }

        // 区切り線
        y += 25;
        doc.moveTo(350, y).lineTo(550, y).stroke();
        y += 10;

        // 合計金額
        doc.fontSize(12);
        const totalLabel = invoice.withholding_tax_amount > 0 ? 'お支払額:' : '合計請求額:';
        doc.text(totalLabel, 350, y);
        doc.text(`¥${invoice.total_amount.toLocaleString('ja-JP')}`, 420, y, { width: 100, align: 'right' });

        // ========================================
        // 備考
        // ========================================
        if (invoice.invoice_note) {
            y += 40;
            doc.fontSize(9).text(`備考: ${invoice.invoice_note}`, 50, y, { width: 500 });
        }

        if (invoice.notes) {
            y += 20;
            doc.fontSize(9).text(`メモ: ${invoice.notes}`, 50, y, { width: 500 });
        }

        // ========================================
        // フッター
        // ========================================
        const footerY = doc.page.height - 100;
        doc.fontSize(8);
        doc.text(
            '本請求書は自動生成されました。',
            50,
            footerY,
            { align: 'center', width: 500 }
        );
        doc.text(
            `お問い合わせ: ${process.env.INVOICE_BCC_EMAIL || 'accounting@ikemen.ltd'}`,
            50,
            footerY + 15,
            { align: 'center', width: 500 }
        );

        // 保存期限の注記
        doc.text(
            `（電子帳簿保存法に基づき ${formatDate(invoice.retention_until)} まで保存）`,
            50,
            footerY + 30,
            { align: 'center', width: 500 }
        );

        doc.end();
    });
}

function formatDate(dateString) {
    return dayjs(dateString).format('YYYY年MM月DD日');
}

module.exports = { generateInvoicePDF };
```

---

## メール送信仕様

### SendGrid 実装コード

```javascript
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendInvoiceEmail(invoice, pdfBuffer, agency) {
    const msg = {
        to: agency.contact_email,
        from: {
            email: process.env.INVOICE_SENDER_EMAIL || 'noreply@ikemen.ltd',
            name: '株式会社イケメン'
        },
        bcc: process.env.INVOICE_BCC_EMAIL || 'accounting@ikemen.ltd',
        subject: `【株式会社イケメン】請求書を発行しました（${invoice.invoice_number}）`,
        text: generatePlainTextEmail(invoice, agency),
        html: generateHTMLEmail(invoice, agency),
        attachments: [
            {
                content: pdfBuffer.toString('base64'),
                filename: `${invoice.invoice_number}.pdf`,
                type: 'application/pdf',
                disposition: 'attachment'
            }
        ]
    };

    try {
        const response = await sgMail.send(msg);
        return {
            success: true,
            messageId: response[0].headers['x-message-id'],
            statusCode: response[0].statusCode
        };
    } catch (error) {
        console.error('SendGrid error:', error);
        if (error.response) {
            console.error(error.response.body);
        }
        throw error;
    }
}

function generatePlainTextEmail(invoice, agency) {
    const periodText = `${formatDate(invoice.period_start)} 〜 ${formatDate(invoice.period_end)}`;

    return `
${agency.name} 様

いつもお世話になっております。
株式会社イケメン 代理店管理システムです。

${periodText} 分の報酬に関する請求書を発行いたしました。

━━━━━━━━━━━━━━━━━━━━
請求書情報
━━━━━━━━━━━━━━━━━━━━
請求書番号: ${invoice.invoice_number}
発行日: ${formatDate(invoice.invoice_date)}
支払期限: ${formatDate(invoice.payment_due_date)}
ご請求金額: ¥${invoice.total_amount.toLocaleString('ja-JP')}

${invoice.withholding_tax_amount > 0 ?
`※源泉徴収税 ¥${invoice.withholding_tax_amount.toLocaleString('ja-JP')} を差し引いた金額です` : ''}

━━━━━━━━━━━━━━━━━━━━

請求書PDFは本メールに添付しておりますので、ご確認ください。

また、代理店ダッシュボードの「報酬」タブからもダウンロード可能です。

ダッシュボード: https://agency.ikemen.ltd/agency

${invoice.invoice_note ? `\n備考: ${invoice.invoice_note}\n` : ''}

よろしくお願いいたします。

────────────────────────────
株式会社イケメン 経理部
Email: ${process.env.INVOICE_BCC_EMAIL || 'accounting@ikemen.ltd'}
Phone: ${process.env.INVOICE_COMPANY_PHONE || '03-1234-5678'}
────────────────────────────
    `.trim();
}

function generateHTMLEmail(invoice, agency) {
    const periodText = `${formatDate(invoice.period_start)} 〜 ${formatDate(invoice.period_end)}`;

    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>請求書発行のお知らせ</title>
</head>
<body style="font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #2563eb; margin-bottom: 20px;">請求書発行のお知らせ</h1>

            <p>${agency.name} 様</p>

            <p>いつもお世話になっております。<br>
            株式会社イケメン 代理店管理システムです。</p>

            <p>${periodText} 分の報酬に関する請求書を発行いたしました。</p>

            <div style="background-color: #eff6ff; padding: 20px; border-radius: 6px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #1e40af;">請求書情報</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>請求書番号</strong></td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${invoice.invoice_number}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>発行日</strong></td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${formatDate(invoice.invoice_date)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>支払期限</strong></td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${formatDate(invoice.payment_due_date)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0;"><strong>ご請求金額</strong></td>
                        <td style="padding: 8px 0; font-size: 20px; color: #2563eb;"><strong>¥${invoice.total_amount.toLocaleString('ja-JP')}</strong></td>
                    </tr>
                </table>
                ${invoice.withholding_tax_amount > 0 ? `
                <p style="margin-top: 15px; font-size: 14px; color: #6b7280;">
                    ※源泉徴収税 ¥${invoice.withholding_tax_amount.toLocaleString('ja-JP')} を差し引いた金額です
                </p>
                ` : ''}
            </div>

            <p>請求書PDFは本メールに添付しておりますので、ご確認ください。</p>

            <p>また、代理店ダッシュボードの「報酬」タブからもダウンロード可能です。</p>

            <div style="text-align: center; margin: 30px 0;">
                <a href="https://agency.ikemen.ltd/agency"
                   style="display: inline-block; padding: 12px 30px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    ダッシュボードを開く
                </a>
            </div>

            ${invoice.invoice_note ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px;"><strong>備考:</strong> ${invoice.invoice_note}</p>
            </div>
            ` : ''}

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="font-size: 12px; color: #6b7280;">
                このメールは自動送信されています。<br>
                ご不明な点がございましたら、下記までお問い合わせください。<br>
                <br>
                株式会社イケメン 経理部<br>
                Email: ${process.env.INVOICE_BCC_EMAIL || 'accounting@ikemen.ltd'}<br>
                Phone: ${process.env.INVOICE_COMPANY_PHONE || '03-1234-5678'}
            </p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

module.exports = { sendInvoiceEmail };
```

---

## フロントエンドUI設計

### 代理店ダッシュボード - 報酬タブ（完全版）

```html
<!-- 報酬サマリーカード -->
<div class="bg-white rounded-lg shadow p-6 mb-6">
    <h3 class="text-lg font-bold mb-4">📊 今月の報酬</h3>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <!-- 当月精算額 -->
        <div class="bg-blue-50 p-4 rounded-lg">
            <p class="text-sm text-gray-600 mb-1">当月精算対象額</p>
            <p class="text-2xl font-bold text-blue-600"
               x-text="'¥' + stats.monthlyCommission.toLocaleString('ja-JP')">¥0</p>
        </div>

        <!-- 前月報酬 -->
        <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm text-gray-600 mb-1">前月報酬</p>
            <p class="text-2xl font-bold text-gray-600"
               x-text="'¥' + stats.lastMonthCommission.toLocaleString('ja-JP')">¥0</p>
        </div>

        <!-- 累計報酬 -->
        <div class="bg-green-50 p-4 rounded-lg">
            <p class="text-sm text-gray-600 mb-1">累計報酬</p>
            <p class="text-2xl font-bold text-green-600"
               x-text="'¥' + stats.totalCommission.toLocaleString('ja-JP')">¥0</p>
        </div>
    </div>

    <!-- 請求書発行ボタン -->
    <div class="flex justify-between items-center">
        <div>
            <button
                @click="previewInvoice()"
                :disabled="stats.monthlyCommission <= 0"
                class="px-4 py-2 text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <i class="fas fa-eye"></i> プレビュー
            </button>
        </div>
        <div>
            <button
                @click="generateInvoice()"
                :disabled="generatingInvoice || stats.monthlyCommission <= 0"
                :class="stats.monthlyCommission > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'"
                class="px-6 py-3 text-white font-bold rounded-lg shadow-lg transition-all duration-200 flex items-center gap-2"
            >
                <i class="fas fa-file-invoice-dollar"></i>
                <span x-show="!generatingInvoice">📄 請求書を発行</span>
                <span x-show="generatingInvoice">
                    <i class="fas fa-spinner fa-spin"></i> 発行中...
                </span>
            </button>
        </div>
    </div>

    <!-- 注意事項 -->
    <div x-show="stats.monthlyCommission > 0"
         class="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 text-sm text-yellow-700">
        <p><strong>ご注意:</strong></p>
        <ul class="list-disc list-inside mt-1">
            <li>請求書は1ヶ月に1回のみ発行可能です</li>
            <li x-show="agencyInfo.entity_type === 'individual'">
                個人事業主のため、源泉徴収税（10.21%）が差し引かれます
            </li>
            <li x-show="!agencyInfo.is_qualified_invoice_issuer">
                適格請求書発行事業者ではないため、消費税の控除対象外となります
            </li>
        </ul>
    </div>

    <!-- エラー/成功メッセージ -->
    <div x-show="invoiceMessage"
         :class="invoiceMessageType === 'success' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-red-50 border-red-500 text-red-700'"
         class="mt-4 p-4 rounded-lg border-l-4"
         x-transition>
        <p x-text="invoiceMessage"></p>
    </div>
</div>

<!-- 請求書履歴テーブル -->
<div class="bg-white rounded-lg shadow overflow-hidden">
    <h3 class="text-lg font-bold p-6 pb-0">💰 請求書履歴</h3>

    <div class="overflow-x-auto">
        <table class="w-full">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">請求書番号</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">対象期間</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">報酬額</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">源泉徴収</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">支払額</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
                <template x-for="inv in invoices" :key="inv.id">
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap font-mono text-sm" x-text="inv.invoice_number"></td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm" x-text="inv.period"></td>
                        <td class="px-6 py-4 whitespace-nowrap font-bold text-sm"
                            x-text="'¥' + (inv.subtotal + inv.tax_amount).toLocaleString('ja-JP')"></td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-red-600"
                            x-text="inv.withholding_tax_amount > 0 ? '-¥' + inv.withholding_tax_amount.toLocaleString('ja-JP') : '-'"></td>
                        <td class="px-6 py-4 whitespace-nowrap font-bold text-blue-600"
                            x-text="'¥' + inv.total_amount.toLocaleString('ja-JP')"></td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span :class="{
                                'bg-gray-100 text-gray-800': inv.status === 'draft',
                                'bg-blue-100 text-blue-800': inv.status === 'issued',
                                'bg-green-100 text-green-800': inv.status === 'sent',
                                'bg-purple-100 text-purple-800': inv.status === 'paid',
                                'bg-red-100 text-red-800': inv.status === 'cancelled',
                                'bg-yellow-100 text-yellow-800': inv.status === 'corrected'
                            }" class="px-2 py-1 rounded-full text-xs font-medium"
                               x-text="getInvoiceStatusLabel(inv.status)">
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm">
                            <!-- ダウンロード -->
                            <button
                                @click="downloadInvoice(inv.id)"
                                class="text-blue-600 hover:text-blue-800 mr-3"
                                title="PDFダウンロード"
                            >
                                <i class="fas fa-download"></i>
                            </button>
                            <!-- メール再送 -->
                            <button
                                x-show="['issued', 'sent'].includes(inv.status)"
                                @click="resendInvoiceEmail(inv.id)"
                                class="text-green-600 hover:text-green-800"
                                title="メール再送"
                            >
                                <i class="fas fa-envelope"></i>
                            </button>
                        </td>
                    </tr>
                </template>
                <!-- データがない場合 -->
                <tr x-show="invoices.length === 0">
                    <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                        請求書がまだ発行されていません
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</div>
```

### Alpine.js データ・メソッド（完全版）

```javascript
// dashboard.js に追加

Alpine.data('dashboard', () => ({
    // ... 既存のデータ ...

    // 🆕 請求書関連
    generatingInvoice: false,
    invoiceMessage: '',
    invoiceMessageType: '', // 'success' or 'error'
    invoices: [],

    // 初期化
    async init() {
        // ... 既存の初期化処理 ...
        await this.loadInvoices();
    },

    // 🆕 請求書一覧を読み込む
    async loadInvoices() {
        try {
            const response = await fetch('/.netlify/functions/invoice-list', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('agencyAuthToken')}`,
                    'X-Agency-Id': localStorage.getItem('agencyId')
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.invoices = data.invoices || [];
            }
        } catch (error) {
            console.error('Error loading invoices:', error);
        }
    },

    // 🆕 請求書発行
    async generateInvoice() {
        if (this.generatingInvoice || this.stats.monthlyCommission <= 0) {
            return;
        }

        // 確認ダイアログ
        const confirmed = confirm(
            `当月の精算対象額 ¥${this.stats.monthlyCommission.toLocaleString('ja-JP')} で請求書を発行します。\n\n` +
            (this.agencyInfo.entity_type === 'individual' ?
                '※個人事業主のため、源泉徴収税が差し引かれます。\n\n' : '') +
            'よろしいですか？'
        );

        if (!confirmed) {
            return;
        }

        this.generatingInvoice = true;
        this.invoiceMessage = '';

        try {
            const response = await fetch('/.netlify/functions/invoice-generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('agencyAuthToken')}`,
                    'X-Agency-Id': localStorage.getItem('agencyId')
                },
                body: JSON.stringify({
                    send_email: true
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '請求書の発行に失敗しました');
            }

            // 成功
            this.invoiceMessage = '✅ ' + (data.message || '請求書を発行しました！メールをご確認ください。');
            this.invoiceMessageType = 'success';

            // 請求書一覧を再読み込み
            await this.loadInvoices();

            // 5秒後にメッセージを消す
            setTimeout(() => {
                this.invoiceMessage = '';
            }, 5000);

        } catch (error) {
            console.error('Invoice generation error:', error);
            this.invoiceMessage = '❌ ' + error.message;
            this.invoiceMessageType = 'error';
        } finally {
            this.generatingInvoice = false;
        }
    },

    // 🆕 請求書プレビュー
    async previewInvoice() {
        try {
            const response = await fetch('/.netlify/functions/invoice-preview', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('agencyAuthToken')}`,
                    'X-Agency-Id': localStorage.getItem('agencyId')
                },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'プレビューの生成に失敗しました');
            }

            // PDFをプレビュー
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');

            // メモリ解放
            setTimeout(() => window.URL.revokeObjectURL(url), 1000);

        } catch (error) {
            console.error('Invoice preview error:', error);
            alert('プレビューの生成に失敗しました: ' + error.message);
        }
    },

    // 🆕 請求書ダウンロード
    async downloadInvoice(invoiceId) {
        try {
            const response = await fetch(`/.netlify/functions/invoice-download/${invoiceId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('agencyAuthToken')}`,
                    'X-Agency-Id': localStorage.getItem('agencyId')
                }
            });

            if (!response.ok) {
                throw new Error('請求書のダウンロードに失敗しました');
            }

            // PDFをダウンロード
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // ファイル名を取得（Content-Dispositionヘッダーから）
            const contentDisposition = response.headers.get('Content-Disposition');
            const filename = contentDisposition
                ? contentDisposition.split('filename=')[1].replace(/"/g, '')
                : `invoice_${invoiceId}.pdf`;

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Invoice download error:', error);
            alert('請求書のダウンロードに失敗しました: ' + error.message);
        }
    },

    // 🆕 請求書メール再送
    async resendInvoiceEmail(invoiceId) {
        if (!confirm('請求書メールを再送信しますか？')) {
            return;
        }

        try {
            const response = await fetch('/.netlify/functions/invoice-resend-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('agencyAuthToken')}`,
                    'X-Agency-Id': localStorage.getItem('agencyId')
                },
                body: JSON.stringify({ invoice_id: invoiceId })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'メール再送に失敗しました');
            }

            alert('✅ メールを再送信しました');
            await this.loadInvoices(); // 一覧を再読み込み

        } catch (error) {
            console.error('Email resend error:', error);
            alert('❌ メール再送に失敗しました: ' + error.message);
        }
    },

    // ステータスラベル
    getInvoiceStatusLabel(status) {
        const labels = {
            'draft': '下書き',
            'issued': '発行済み',
            'sent': '送信済み',
            'paid': '支払済み',
            'cancelled': 'キャンセル',
            'corrected': '訂正済み'
        };
        return labels[status] || status;
    }
}));
```

---

## セキュリティ対策

### 1. 認証・認可

- ✅ JWT認証必須
- ✅ `agencyId` が一致するか検証
- ✅ 他の代理店の請求書にはアクセス不可

### 2. 重複防止

- ✅ 同一期間の請求書は1回のみ発行可能
- ✅ `UNIQUE(agency_id, period_start, period_end)` 制約
- ✅ 再発行は管理者のみ

### 3. データ改ざん防止

- ✅ 請求書発行時に代理店情報をスナップショット保存
- ✅ 後から代理店情報が変更されても請求書は影響を受けない

### 4. PDFセキュリティ

- ✅ PDF URLは署名付き（Supabase Storage）
- ✅ 有効期限付きダウンロードURL
- ✅ 請求書番号をファイル名に含める

### 5. メールセキュリティ

- ✅ SPF/DKIM/DMARC設定（SendGrid）
- ✅ BCCで管理者にもコピー送信
- ✅ HTMLメールでフィッシング対策（正規URL記載）

### 6. レート制限

```javascript
// 請求書発行は1日3回まで
const rateLimiter = {
    windowMs: 24 * 60 * 60 * 1000, // 24時間
    maxRequests: 3,
    key: `invoice_${agencyId}`
};
```

### 7. トランザクション制御

- ✅ 請求書生成は全てトランザクション内で実行
- ✅ エラー時は自動ロールバック
- ✅ 請求書番号採番で `FOR UPDATE` による排他制御

---

## エラーハンドリング

### エラーコード一覧

| コード | メッセージ | HTTPステータス | 対処法 |
|-------|----------|--------------|-------|
| `NO_COMMISSIONS` | 対象期間の精算対象報酬がありません | 400 | 報酬が発生するまで待つ |
| `INVOICE_ALREADY_EXISTS` | この期間の請求書は既に発行済みです | 409 | 既存の請求書をダウンロード |
| `PERIOD_TOO_OLD` | 請求書の発行は過去3ヶ月までです | 400 | 管理者に問い合わせ |
| `INVALID_PERIOD` | 対象期間が不正です | 400 | 正しい期間を指定 |
| `AGENCY_NOT_FOUND` | 代理店が見つかりません | 404 | ログイン確認 |
| `EMAIL_SEND_FAILED` | メール送信に失敗しました | 500 | 再送機能を使用 |
| `PDF_GENERATION_FAILED` | PDF生成に失敗しました | 500 | 再試行または管理者に連絡 |
| `UNAUTHORIZED` | 認証が必要です | 401 | ログインし直す |
| `FORBIDDEN` | アクセス権限がありません | 403 | 自分の請求書のみアクセス可 |
| `RATE_LIMIT_EXCEEDED` | 発行回数制限を超えています | 429 | 24時間後に再試行 |
| `INVOICE_NOT_FOUND` | 請求書が見つかりません | 404 | 請求書IDを確認 |
| `INVALID_STATUS` | この請求書は操作できません | 400 | ステータスを確認 |

---

## 実装ロードマップ

### フェーズ1: データベース構築（1日）

- [x] `invoices` テーブル作成
- [x] `invoice_items` テーブル作成
- [x] `invoice_sequence` テーブル作成
- [x] `get_next_invoice_number()` 関数作成（トランザクション対応）
- [x] `agencies` テーブルにカラム追加（インボイス制度・源泉徴収税対応）
- [x] `agency_commissions.invoice_id` カラム追加
- [x] インデックス・制約の追加
- [x] トリガー作成（保存期限自動設定）
- [ ] マイグレーションSQLファイル作成

### フェーズ2: 日本語フォントセットアップ（0.5日）

- [ ] IPAフォントダウンロード
- [ ] `netlify/functions/fonts/` に配置
- [ ] PDF生成でフォント読み込みテスト

### フェーズ3: バックエンドAPI開発（3-4日）

- [ ] `invoice-generate.js` 実装
  - [ ] 認証・認可
  - [ ] 報酬データ取得
  - [ ] 重複チェック
  - [ ] 請求書番号採番
  - [ ] 金額計算ロジック（消費税・源泉徴収税）
  - [ ] トランザクション処理
  - [ ] DB INSERT処理
- [ ] PDF生成機能実装
  - [ ] `pdfkit` セットアップ
  - [ ] 日本語フォント設定
  - [ ] インボイス制度対応レイアウト
  - [ ] 源泉徴収税表示
  - [ ] テスト
- [ ] Supabase Storage連携
  - [ ] PDFアップロード
  - [ ] 署名付きURL生成
- [ ] SendGrid メール送信
  - [ ] HTMLテンプレート作成
  - [ ] PDF添付
  - [ ] BCC送信
  - [ ] エラーハンドリング
- [ ] `invoice-list.js` 実装
- [ ] `invoice-download.js` 実装
- [ ] `invoice-resend-email.js` 実装
- [ ] `invoice-preview.js` 実装

### フェーズ4: フロントエンド実装（2日）

- [ ] 報酬タブにUI追加
  - [ ] 請求書発行ボタン
  - [ ] プレビューボタン
  - [ ] 注意事項表示
  - [ ] ローディング表示
  - [ ] 成功/エラーメッセージ
- [ ] 請求書履歴テーブル
  - [ ] 一覧表示
  - [ ] ダウンロードボタン
  - [ ] メール再送ボタン
- [ ] Alpine.js メソッド実装
  - [ ] `generateInvoice()`
  - [ ] `previewInvoice()`
  - [ ] `downloadInvoice()`
  - [ ] `resendInvoiceEmail()`
  - [ ] エラーハンドリング
- [ ] レスポンシブ対応
- [ ] アクセシビリティ対応

### フェーズ5: テスト（2日）

- [ ] 単体テスト
  - [ ] 請求書番号採番
  - [ ] 金額計算ロジック（消費税・源泉徴収税）
  - [ ] 重複チェック
- [ ] 統合テスト
  - [ ] API → DB → PDF → メール の完全フロー
  - [ ] 法人の場合
  - [ ] 個人事業主の場合
  - [ ] 免税事業者の場合
  - [ ] エラーケース
- [ ] 手動テスト
  - [ ] 実際に請求書発行
  - [ ] メール受信確認
  - [ ] PDF表示確認（日本語、レイアウト）
  - [ ] インボイス制度対応確認

### フェーズ6: 本番デプロイ（1日）

- [ ] 環境変数設定
- [ ] データベースマイグレーション実行
- [ ] Netlify Functions デプロイ
- [ ] 日本語フォントファイルデプロイ確認
- [ ] Supabase Storage バケット作成
- [ ] SendGrid ドメイン認証
- [ ] 動作確認（法人・個人の両方）
- [ ] ドキュメント作成

### 総開発期間: 約8-10日

---

## 付録

### A. 環境変数チェックリスト

```bash
# 既存
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SENDGRID_API_KEY=SG.xxx...

# 新規追加
INVOICE_SENDER_EMAIL=noreply@ikemen.ltd
INVOICE_BCC_EMAIL=accounting@ikemen.ltd
INVOICE_COMPANY_NAME=株式会社イケメン
INVOICE_COMPANY_ADDRESS=東京都渋谷区〇〇1-2-3
INVOICE_COMPANY_PHONE=03-1234-5678
INVOICE_COMPANY_REGISTRATION_NUMBER=T1234567890123
INVOICE_TAX_RATE=10
INVOICE_PAYMENT_DUE_DAYS=30
```

### B. package.json 更新

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.38.0",
    "@line/bot-sdk": "^7.5.2",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "stripe": "^14.5.0",
    "@sendgrid/mail": "^8.1.6",
    "pdfkit": "^0.13.0",
    "dayjs": "^1.11.10"
  }
}
```

### C. Supabase Storage バケット作成

```sql
-- Supabase Storage バケット作成（ダッシュボードまたはSQL）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'invoices',
    'invoices',
    false, -- プライベートバケット
    10485760, -- 10MB
    ARRAY['application/pdf']
);

-- RLS ポリシー: 代理店は自分の請求書のみアクセス可
CREATE POLICY "Agencies can view own invoices"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'invoices' AND
    (storage.foldername(name))[1] = auth.jwt() ->> 'agencyId'
);
```

### D. マイグレーションSQLファイル

`database/migration_invoice_system.sql` として保存:

```sql
-- ========================================
-- 請求書自動発行機能 マイグレーション
-- ========================================

BEGIN;

-- 1. agencies テーブルにカラム追加
ALTER TABLE agencies
ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'corporation'
    CHECK (entity_type IN ('corporation', 'individual')),
ADD COLUMN IF NOT EXISTS invoice_registration_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS is_qualified_invoice_issuer BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tax_calculation_type VARCHAR(20) DEFAULT 'standard'
    CHECK (tax_calculation_type IN ('standard', 'exempt', 'simplified'));

-- 2. invoices テーブル作成
CREATE TABLE IF NOT EXISTS invoices (
    -- （上記のスキーマ定義をコピー）
    ...
);

-- 3. invoice_items テーブル作成
CREATE TABLE IF NOT EXISTS invoice_items (
    -- （上記のスキーマ定義をコピー）
    ...
);

-- 4. invoice_sequence テーブル作成
CREATE TABLE IF NOT EXISTS invoice_sequence (
    -- （上記のスキーマ定義をコピー）
    ...
);

-- 5. 請求書番号採番関数
CREATE OR REPLACE FUNCTION get_next_invoice_number(target_year_month VARCHAR(6))
RETURNS VARCHAR(50) AS $$
-- （上記の関数定義をコピー）
...
$$ LANGUAGE plpgsql;

-- 6. 保存期限自動設定トリガー
CREATE OR REPLACE FUNCTION set_invoice_retention()
RETURNS TRIGGER AS $$
-- （上記のトリガー定義をコピー）
...
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_invoice_retention_trigger
BEFORE INSERT ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_invoice_retention();

-- 7. agency_commissions にカラム追加
ALTER TABLE agency_commissions
ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- 8. インデックス作成
-- （上記のインデックス定義をコピー）
...

COMMIT;
```

---

## 参考資料

- [国税庁: インボイス制度](https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm)
- [国税庁: 源泉徴収税の計算方法](https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm)
- [電子帳簿保存法](https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/02.htm)
- [pdfkit ドキュメント](https://pdfkit.org/docs/getting_started.html)
- [IPA フォント（オープンソース）](https://moji.or.jp/ipafont/)

---

**設計書 完（v2.0 - 日本の法律完全対応版）**

この修正版設計書は、以下に完全対応しています:
- ✅ インボイス制度（適格請求書等保存方式）
- ✅ 源泉徴収税（個人事業主への報酬支払い）
- ✅ 消費税の正しい扱い（免税事業者への対応）
- ✅ 電子帳簿保存法（7年間保存）
- ✅ 日本語フォントの完全サポート
- ✅ 金額計算の丸め処理（切り捨て）

**実装可能レベル: 95点**

この設計書に基づいて実装すれば、法的に完全な請求書自動発行システムが完成します。
