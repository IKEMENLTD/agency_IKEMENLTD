# 請求書自動発行機能 設計レビュー報告書

**レビュー日:** 2025-10-28
**レビュー対象:** INVOICE_AUTO_GENERATION_DESIGN.md v1.0
**レビュー結果:** ⚠️ **重大な問題14件、中程度の問題8件を検出**

---

## 🔴 重大な問題（Critical Issues）

### 1. ❌ インボイス制度（適格請求書）への対応が欠落

**問題:**
日本では2023年10月からインボイス制度（適格請求書等保存方式）が導入されているが、設計書に全く含まれていない。

**影響:**
- 適格請求書発行事業者の登録番号が必要
- 請求書に「登録番号」を記載しないと、受領側（株式会社イケメン）で仕入税額控除ができない
- 法的に不完全な請求書になる

**必須対応:**

#### データベース修正
```sql
-- agencies テーブルに追加
ALTER TABLE agencies
ADD COLUMN invoice_registration_number VARCHAR(20), -- 適格請求書発行事業者登録番号（T+13桁）
ADD COLUMN is_qualified_invoice_issuer BOOLEAN DEFAULT false; -- 適格請求書発行事業者か
```

#### PDF に追加表示
```
【請求元】
代理店名: 〇〇株式会社
適格請求書発行事業者登録番号: T1234567890123  ← 必須
```

#### 免税事業者の場合
- `is_qualified_invoice_issuer = false` の場合、消費税を請求できない
- または、区分記載請求書（経過措置）として発行
- 設計書にこの分岐処理がない

---

### 2. ❌ 請求書の「請求元」「請求先」の定義が混乱

**問題:**
設計書の「ビジネス要件」セクションで:
> - **請求元**: 株式会社イケメン（または代理店名）
> - **請求先**: 株式会社イケメン 経理部（固定）

これは論理的に矛盾している。

**正しい定義:**
- **請求元**: 代理店（報酬を受け取る側）
- **請求先**: 株式会社イケメン（報酬を支払う側）

**修正箇所:**
設計書の「ビジネス要件」セクションを修正し、混乱を解消する。

---

### 3. ❌ 消費税の扱いが曖昧

**問題:**
設計書では一律「消費税10%」を課税しているが、以下のケースが考慮されていない:

#### ケース1: 代理店が免税事業者の場合
- 年間売上1,000万円未満の個人事業主・法人は免税事業者
- 免税事業者は消費税を請求する義務はないが、請求することも可能
- インボイス制度では、免税事業者からの請求書は仕入税額控除の対象外

#### ケース2: 代理店が課税事業者だが簡易課税の場合
- 簡易課税制度を選択している場合、消費税の計算方法が異なる

#### ケース3: 代理店が適格請求書発行事業者でない場合
- 適格請求書発行事業者でない場合、消費税を請求しても控除されない
- 経過措置（2026年9月まで80%控除、2029年9月まで50%控除）

**必須対応:**
```sql
-- agencies テーブルに追加
ALTER TABLE agencies
ADD COLUMN tax_calculation_type VARCHAR(20) DEFAULT 'standard'
    CHECK (tax_calculation_type IN ('standard', 'exempt', 'simplified'));
    -- standard: 標準課税
    -- exempt: 免税事業者
    -- simplified: 簡易課税
```

**PDF生成ロジック:**
```javascript
// 消費税計算の分岐
if (agency.is_qualified_invoice_issuer && agency.tax_calculation_type !== 'exempt') {
    taxAmount = subtotal * (taxRate / 100);
} else {
    // 免税事業者の場合、消費税は表示しない
    taxAmount = 0;
    // または「※免税事業者のため、消費税は含まれません」と記載
}
```

---

### 4. ❌ PDF生成で日本語フォントの配置方法が未定義

**問題:**
`pdfkit` は日本語フォントを別途用意する必要があるが、Netlify Functions 環境でのフォントファイル配置方法が記載されていない。

**影響:**
- フォントがないと日本語が表示されない（文字化け）
- 実装時に詰まる可能性が高い

**必須対応:**

#### オプション1: IPAフォントを同梱
```bash
# プロジェクトにフォントを追加
mkdir -p netlify/functions/fonts
# IPAフォントをダウンロード（オープンソース）
wget https://moji.or.jp/wp-content/ipafont/IPAexfont/IPAexfont00401.zip
unzip IPAexfont00401.zip
cp ipaexg.ttf netlify/functions/fonts/
```

```javascript
// PDF生成コード
const fontPath = path.join(__dirname, 'fonts', 'ipaexg.ttf');
doc.font(fontPath);
```

#### オプション2: Google Fonts API 使用
```javascript
// Noto Sans JP を動的ダウンロード
const fontUrl = 'https://fonts.gstatic.com/s/notosansjp/...';
const fontBuffer = await fetch(fontUrl).then(r => r.buffer());
doc.font(fontBuffer);
```

**推奨:** オプション1（フォント同梱）の方が安定

---

### 5. ❌ 金額の丸め処理が未定義

**問題:**
消費税計算で端数が出た場合の処理（切り捨て/切り上げ/四捨五入）が明記されていない。

**例:**
- 報酬額: ¥525,555
- 消費税(10%): ¥52,555.5 ← 端数が出る

**日本の商習慣:**
- **切り捨て**: 一般的（¥52,555）
- 四捨五入: 一部の業界
- 切り上げ: 稀

**必須対応:**
```javascript
// 消費税の計算（切り捨て）
const taxAmount = Math.floor(subtotal * (taxRate / 100));

// または、設定で変更可能にする
const taxAmount = calculateTax(subtotal, taxRate, 'floor'); // 'floor', 'ceil', 'round'
```

**設計書に明記:**
> 消費税は **切り捨て** で計算する（日本の一般的な商習慣に従う）

---

### 6. ❌ 過去の月の請求書発行が不可能な制約が厳しすぎる

**問題:**
設計書では:
> - 過去の月の請求書は発行不可（当月のみ）

**問題点:**
- 月初に発行し忘れた場合、翌月になったら永久に発行できなくなる
- システムメンテナンス等で数日遅れた場合も発行不可
- 実務上、使いにくい

**推奨修正:**
```javascript
// 当月 + 過去3ヶ月まで発行可能
const allowedPeriodStart = new Date();
allowedPeriodStart.setMonth(allowedPeriodStart.getMonth() - 3);

if (requestedPeriodStart < allowedPeriodStart) {
    return {
        error: '請求書の発行は過去3ヶ月までです。それ以前の期間については管理者にお問い合わせください。',
        code: 'PERIOD_TOO_OLD'
    };
}
```

---

### 7. ❌ Supabase Storage への認証方法が未定義

**問題:**
設計書に Supabase Storage バケット作成の SQL は含まれているが、Netlify Functions から Storage にアップロードする際の認証方法（API キー、サービスロールキー）が明記されていない。

**必須対応:**
```javascript
// Netlify Functions から Supabase Storage にアップロード
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // ← サービスロールキーが必要
);

// PDFアップロード
const { data, error } = await supabase.storage
    .from('invoices')
    .upload(`${agencyId}/${invoice.invoice_number}.pdf`, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false
    });
```

**設計書に追加:**
- Netlify Functions 環境変数に `SUPABASE_SERVICE_ROLE_KEY` が必要
- RLS ポリシーの詳細設定

---

### 8. ❌ メール送信失敗時の再送機能が未設計

**問題:**
設計書では:
> PDFは生成されたがメール送信失敗の場合、status を 'issued' にする

しかし、その後のメール再送機能が設計されていない。

**影響:**
- 代理店は請求書をダウンロードできるが、メールが届かない
- 管理者が手動でメール送信する必要がある（煩雑）

**必須対応:**

#### API追加: POST `/invoice-resend-email/{invoice_id}`
```javascript
exports.handler = async (event) => {
    const { invoice_id } = event.pathParameters;

    // 請求書取得
    const invoice = await getInvoice(invoice_id);

    // status が 'issued' または 'sent' の請求書のみ再送可能
    if (!['issued', 'sent'].includes(invoice.status)) {
        return { statusCode: 400, body: JSON.stringify({ error: '再送できない状態です' }) };
    }

    // PDF取得
    const pdfBuffer = await downloadPDFFromStorage(invoice.pdf_url);

    // メール再送
    await sendInvoiceEmail(invoice, pdfBuffer, agency);

    // status 更新
    await updateInvoiceStatus(invoice_id, 'sent');

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
```

#### フロントエンドUI
```html
<!-- 請求書一覧に「再送」ボタンを追加 -->
<button
    x-show="invoice.status === 'issued'"
    @click="resendInvoiceEmail(invoice.id)"
    class="text-blue-600 hover:text-blue-800"
>
    <i class="fas fa-envelope"></i> メール再送
</button>
```

---

### 9. ❌ 管理者用の請求書再発行API が未設計

**問題:**
設計書では:
> - 再発行は管理者のみ

しかし、管理者用のAPI設計がない。

**必須対応:**

#### API追加: POST `/admin/invoice-regenerate`
```javascript
exports.handler = async (event) => {
    // 管理者認証チェック
    if (!isAdmin(event)) {
        return { statusCode: 403, body: JSON.stringify({ error: '管理者権限が必要です' }) };
    }

    const { agency_id, period_start, period_end, force_regenerate } = JSON.parse(event.body);

    if (force_regenerate) {
        // 既存の請求書を 'cancelled' にする
        await cancelExistingInvoice(agency_id, period_start, period_end);
    }

    // 新規請求書生成
    const invoice = await generateInvoice({ agency_id, period_start, period_end });

    return { statusCode: 200, body: JSON.stringify({ invoice }) };
};
```

---

### 10. ❌ 請求書番号の採番関数で競合が発生する可能性

**問題:**
`get_next_invoice_number()` 関数で `INSERT ... ON CONFLICT DO UPDATE` を使っているが、サーバーレス環境で複数のリクエストが同時に実行された場合、競合する可能性がある。

**PostgreSQL の動作:**
```sql
INSERT INTO invoice_sequence (year_month, last_number)
VALUES ('202510', 1)
ON CONFLICT (year_month) DO UPDATE
SET last_number = invoice_sequence.last_number + 1,
    updated_at = NOW()
RETURNING last_number;
```

この処理は **SERIALIZABLE 分離レベル** で実行しないと、同時実行時に同じ番号が返される可能性がある。

**必須対応:**
```sql
-- トランザクション分離レベルを SERIALIZABLE にする
CREATE OR REPLACE FUNCTION get_next_invoice_number(target_year_month VARCHAR(6))
RETURNS VARCHAR(50) AS $$
DECLARE
    next_num INTEGER;
    invoice_num VARCHAR(50);
BEGIN
    -- トランザクション分離レベルを SERIALIZABLE に設定
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

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

    invoice_num := 'INV-' || target_year_month || '-' || LPAD(next_num::TEXT, 5, '0');

    RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;
```

または、Supabase の RPC 呼び出し時に明示的にトランザクションを使う。

---

### 11. ❌ 請求書のPDFレイアウトに源泉徴収税の考慮がない

**問題:**
日本では、個人事業主への報酬支払い時に **源泉徴収税（10.21%）** を差し引く必要がある。

**対象:**
- 代理店が個人事業主の場合
- 報酬額が100万円以下: 10.21%
- 報酬額が100万円超: 超過分は20.42%

**影響:**
- 法人の場合は源泉徴収不要
- 個人事業主の場合は必須
- 設計書に全く考慮されていない

**必須対応:**

#### データベース
```sql
ALTER TABLE agencies
ADD COLUMN entity_type VARCHAR(20) DEFAULT 'corporation'
    CHECK (entity_type IN ('corporation', 'individual'));
    -- corporation: 法人
    -- individual: 個人事業主
```

#### PDF生成ロジック
```javascript
let withholdingTax = 0;

if (agency.entity_type === 'individual') {
    // 源泉徴収税の計算
    if (subtotal <= 1000000) {
        withholdingTax = Math.floor(subtotal * 0.1021);
    } else {
        withholdingTax = Math.floor(1000000 * 0.1021) + Math.floor((subtotal - 1000000) * 0.2042);
    }
}

const totalAmount = subtotal + taxAmount - withholdingTax;
```

#### PDFレイアウト
```
小計:                    ¥530,000
消費税(10%):             ¥53,000
源泉徴収税(10.21%):      -¥54,113  ← 個人事業主の場合のみ表示
───────────────────────────────
お支払額:                ¥528,887
```

**これは非常に重大な問題です。**

---

### 12. ❌ 請求書の保存期間・削除ポリシーが未定義

**問題:**
- 請求書PDFをいつまで保存するか？
- 代理店が退会した場合、請求書データはどうするか？
- 法的保存期間（7年）への対応は？

**日本の法律:**
- 法人税法: 帳簿書類の保存期間は **7年間**
- 電子帳簿保存法: 電子データも7年保存が必要

**必須対応:**
```sql
ALTER TABLE invoices
ADD COLUMN archived_at TIMESTAMP, -- アーカイブ日時
ADD COLUMN retention_until DATE;  -- 保存期限（発行日から7年後）

-- トリガーで自動設定
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
```

**削除ポリシー:**
- 代理店が退会しても請求書は削除しない（CASCADE を外す）
- 7年経過後、管理者が手動でアーカイブ

---

### 13. ❌ 請求書の訂正・取消の機能が未設計

**問題:**
- 請求書発行後に金額誤りが発覚した場合、どうするか？
- 請求書の取消・訂正の機能がない

**日本の商習慣:**
- 誤った請求書は「取消請求書」を発行
- 正しい請求書を再発行
- または「訂正請求書」を発行

**必須対応:**

#### データベース
```sql
ALTER TABLE invoices
ADD COLUMN parent_invoice_id UUID REFERENCES invoices(id), -- 訂正元の請求書
ADD COLUMN correction_reason TEXT, -- 訂正理由
ADD COLUMN is_correction BOOLEAN DEFAULT false; -- 訂正請求書か

-- status に 'corrected' を追加
ALTER TABLE invoices
DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices
ADD CONSTRAINT invoices_status_check
CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'cancelled', 'corrected'));
```

#### API追加
```javascript
// POST /admin/invoice-correct
// 既存の請求書を 'corrected' にして、新規請求書を作成
```

---

### 14. ❌ 複数サービスの報酬を1枚の請求書にまとめる際の明細表示が不明確

**問題:**
設計書では、複数サービス（TaskMate AI、LiteWEB+ など）の報酬を1枚の請求書にまとめるとあるが、明細の表示順序・グルーピングが明記されていない。

**推奨:**
```sql
-- invoice_items に sort_order を追加（既にある）
-- サービスID順でソート
ORDER BY service_id, sort_order
```

---

## 🟠 中程度の問題（Medium Issues）

### 15. ⚠️ レート制限が24時間1回は厳しすぎる

**問題:**
誤操作で請求書を発行した場合、24時間待つ必要がある。

**推奨:**
- 1日3回まで許可
- または、管理者が制限を解除できる機能

### 16. ⚠️ 請求書PDFのファイル名に日本語が使えない

**問題:**
SendGrid の添付ファイル名で日本語が文字化けする可能性。

**推奨:**
```javascript
filename: `invoice_${invoice.invoice_number}_${agency.code}.pdf`
// 例: invoice_INV-202510-00001_AG1A2B3C.pdf
```

### 17. ⚠️ 請求書のプレビュー機能がない

**問題:**
発行前にPDFをプレビューできない。

**推奨:**
```javascript
// GET /invoice-preview?period_start=2025-10-01
// PDF生成してプレビュー表示（DB保存はしない）
```

### 18. ⚠️ 請求書発行の通知が代理店のみ

**問題:**
管理者（経理部）への通知が BCC のみ。

**推奨:**
- 管理者にも別途通知メール
- Slack 通知
- ダッシュボードに「新規請求書」バッジ

### 19. ⚠️ 環境変数の検証がない

**問題:**
必須の環境変数が未設定でもエラーにならない。

**推奨:**
```javascript
// Netlify Functions 起動時に環境変数チェック
const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SENDGRID_API_KEY',
    'INVOICE_SENDER_EMAIL',
    'INVOICE_BCC_EMAIL'
];

requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        throw new Error(`環境変数 ${varName} が設定されていません`);
    }
});
```

### 20. ⚠️ 請求書の検索機能がない

**問題:**
請求書番号・期間・ステータスで検索できない。

**推奨:**
```javascript
// GET /invoice-list?status=sent&period_start=2025-10-01&search=INV-202510
```

### 21. ⚠️ 請求書の一括ダウンロード機能がない

**問題:**
複数の請求書をZIPでまとめてダウンロードできない。

**推奨:**
```javascript
// POST /invoice-bulk-download
// body: { invoice_ids: ['uuid1', 'uuid2'] }
// → ZIP生成して返却
```

### 22. ⚠️ 代理店情報変更時のスナップショット更新ロジックが未定義

**問題:**
請求書発行後に代理店の住所や振込先が変更された場合、過去の請求書に影響するか？

**現在の設計:**
- 請求書発行時に代理店情報をスナップショット保存（正しい）

**しかし:**
- `agency_name` などを invoice テーブルに保存しているが、`payment_info` はどうするか？

**推奨:**
```sql
ALTER TABLE invoices
ADD COLUMN agency_payment_info JSONB; -- 請求書発行時の振込先情報（スナップショット）
```

---

## ✅ 良い点（Good Points）

設計書の優れている点も記載します:

1. ✅ **データベース設計が詳細** - テーブル構造が明確
2. ✅ **API設計が具体的** - リクエスト/レスポンス例がある
3. ✅ **エラーハンドリングが考慮されている** - エラーコード定義
4. ✅ **セキュリティ対策が含まれている** - JWT認証、重複防止
5. ✅ **フロントエンドUIが実装可能なレベル** - Alpine.js コード例
6. ✅ **実装ロードマップが現実的** - 5-8日で実装可能
7. ✅ **PDFレイアウトが具体的** - 視覚的に分かりやすい
8. ✅ **メール送信の HTML テンプレート** - プロフェッショナル

---

## 📊 総合評価

| 項目 | 評価 | コメント |
|-----|------|---------|
| **データベース設計** | B+ | 良好だが、インボイス制度対応が欠落 |
| **API設計** | B | 基本的な設計は良いが、管理者用APIが不足 |
| **PDF生成** | C+ | 日本語フォント問題、インボイス制度未対応 |
| **セキュリティ** | B- | 基本的な対策はあるが、レート制限が厳しすぎ |
| **ビジネスロジック** | C | 消費税・源泉徴収税の扱いが不完全 |
| **エラーハンドリング** | B+ | 良好 |
| **実装可能性** | A- | ロードマップは現実的 |

**総合点: 70/100**

---

## 🎯 優先度付き修正リスト

### 最優先（実装前に必須）

1. ✅ インボイス制度対応（適格請求書発行事業者登録番号）
2. ✅ 源泉徴収税の対応（個人事業主の場合）
3. ✅ 消費税の扱いを明確化（免税事業者の場合）
4. ✅ 金額の丸め処理を定義
5. ✅ 日本語フォントの配置方法を明記
6. ✅ 請求書番号採番のトランザクション分離レベル修正

### 高優先度（実装初期に対応）

7. ✅ メール送信失敗時の再送機能
8. ✅ 管理者用の請求書再発行API
9. ✅ 過去月の請求書発行制限を緩和（3ヶ月前まで）
10. ✅ Supabase Storage 認証方法の明記
11. ✅ 請求書の保存期間・削除ポリシー

### 中優先度（実装中盤に対応）

12. ✅ 請求書の訂正・取消機能
13. ✅ 請求書のプレビュー機能
14. ✅ 環境変数の検証
15. ⚠️ レート制限の緩和

### 低優先度（機能追加として）

16. 請求書の検索機能
17. 請求書の一括ダウンロード
18. 管理者への Slack 通知
19. 請求書発行の承認フロー

---

## 📝 推奨される修正手順

### ステップ1: 設計書の修正（1日）
- 上記の重大な問題を設計書に反映
- インボイス制度、源泉徴収税の章を追加
- データベーススキーマを更新

### ステップ2: 技術検証（1日）
- 日本語フォントの動作確認
- pdfkit でインボイス制度対応の請求書レイアウト作成
- サンプルPDF生成

### ステップ3: 実装（5-8日）
- 修正された設計書に基づいて実装

---

## 🔗 参考資料

- [国税庁: インボイス制度](https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm)
- [国税庁: 源泉徴収税の計算方法](https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm)
- [電子帳簿保存法](https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/02.htm)
- [pdfkit 日本語フォント対応](https://pdfkit.org/docs/text.html#fonts)

---

**レビュー完了**

この設計書は **70点** です。基本的な設計は良好ですが、日本の法律・商習慣への対応が不足しています。

上記の修正を行えば、**実用可能なレベル（90点）** になります。

修正版の設計書を作成しますか？
