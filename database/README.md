# データベースセットアップガイド

## 📋 概要

このディレクトリには、株式会社イケメン 代理店管理システムのデータベーススキーマとセットアップスクリプトが含まれています。

**✅ 完璧なSQL**: エラーチェック済み、何度実行してもエラーが出ない冪等性を保証

---

## 🚀 初回セットアップ手順

### 1. Supabaseダッシュボードにアクセス

1. https://supabase.com/dashboard を開く
2. プロジェクトを選択
3. **SQL Editor** タブをクリック

### 2. セットアップスクリプトを実行

`setup-services-table.sql` の内容をコピーして、SQL Editorに貼り付けて実行します。

```bash
# ファイルを開く
cat database/setup-services-table.sql
```

**このスクリプトは以下を実行します:**
- ✅ `services` テーブルの作成
- ✅ `agency_service_settings` テーブルの作成
- ✅ `agency_tracking_links` に必要なカラムを追加
- ✅ 初期サービスデータの投入（TaskMate AI, LiteWEB+）
- ✅ インデックスの作成

### 3. 実行結果の確認

スクリプト実行後、以下のメッセージが表示されればOKです:

```
✅ セットアップ完了！
service_count: 2
services: TaskMate AI (20%), LiteWEB+ (20%)
```

---

## 🔧 報酬率が間違っている場合

既に間違った報酬率でサービスが登録されている場合は、`fix-commission-rates.sql` を実行してください。

```sql
-- 全サービスの報酬率を20%に統一
UPDATE services
SET default_commission_rate = 20.00,
    default_referral_rate = 0.00,
    updated_at = NOW()
WHERE status = 'active';
```

---

## 📊 設定される報酬率

### 基本ルール
**全サービス共通: 粗利の20%**

| サービス名   | 報酬率 | 紹介率 | 月額料金 |
|------------|-------|-------|---------|
| TaskMate AI | 20%   | 0%    | ¥2,980  |
| LiteWEB+    | 20%   | 0%    | ¥4,980  |

### 計算例

#### TaskMate AI の場合
- 月額料金: ¥2,980
- 粗利（仮に70%とすると）: ¥2,086
- 代理店報酬: ¥2,086 × 20% = **¥417**

#### LiteWEB+ の場合
- 月額料金: ¥4,980
- 粗利（仮に70%とすると）: ¥3,486
- 代理店報酬: ¥3,486 × 20% = **¥697**

---

## 🗄️ テーブル構造

### `services` テーブル

サービスのマスターデータを管理します。

| カラム名                 | データ型    | 説明                    |
|------------------------|-----------|------------------------|
| id                     | UUID      | サービスID（主キー）      |
| name                   | VARCHAR   | サービス名（一意）        |
| description            | TEXT      | サービス説明             |
| domain                 | VARCHAR   | ドメイン名              |
| default_commission_rate| NUMERIC   | デフォルト報酬率（20%）   |
| default_referral_rate  | NUMERIC   | デフォルト紹介率（0%）    |
| subscription_price     | NUMERIC   | 月額料金                |
| status                 | VARCHAR   | ステータス（active/inactive）|
| created_at             | TIMESTAMP | 作成日時                |
| updated_at             | TIMESTAMP | 更新日時                |

### `agency_service_settings` テーブル

代理店ごとのカスタム報酬率を管理します。

| カラム名         | データ型    | 説明                           |
|-----------------|-----------|-------------------------------|
| id              | UUID      | 設定ID（主キー）                |
| agency_id       | UUID      | 代理店ID（外部キー）             |
| service_id      | UUID      | サービスID（外部キー）           |
| commission_rate | NUMERIC   | カスタム報酬率（NULL=デフォルト） |
| referral_rate   | NUMERIC   | カスタム紹介率（NULL=デフォルト） |
| is_active       | BOOLEAN   | 有効フラグ                     |
| created_at      | TIMESTAMP | 作成日時                       |
| updated_at      | TIMESTAMP | 更新日時                       |

**制約:**
- `(agency_id, service_id)` はユニーク（代理店×サービスは1つだけ）

---

## ✅ セットアップ確認クエリ

### 全サービスを確認
```sql
SELECT
    name as "サービス名",
    default_commission_rate as "報酬率(%)",
    subscription_price as "月額(円)",
    status as "ステータス"
FROM services
ORDER BY name;
```

### 代理店のカスタム設定を確認
```sql
SELECT
    a.name as "代理店名",
    s.name as "サービス名",
    COALESCE(ass.commission_rate, s.default_commission_rate) as "報酬率(%)",
    ass.is_active as "有効"
FROM agencies a
JOIN agency_service_settings ass ON a.id = ass.agency_id
JOIN services s ON ass.service_id = s.id
ORDER BY a.name, s.name;
```

---

## 🔍 トラブルシューティング

### Q1: サービスドロップダウンに何も表示されない

**原因:** `services` テーブルが存在しない、またはデータが空

**解決策:**
```sql
-- servicesテーブルの存在確認
SELECT * FROM services;

-- 何も返ってこない場合は、setup-services-table.sql を実行
```

### Q2: 報酬率が20%になっていない

**解決策:**
```sql
-- fix-commission-rates.sql を実行
UPDATE services
SET default_commission_rate = 20.00
WHERE status = 'active';
```

### Q3: agency_tracking_links に service_id カラムがない

**解決策:**
```sql
-- setup-services-table.sql の該当部分を実行
ALTER TABLE agency_tracking_links
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id);
```

---

## 📝 ファイル一覧

| ファイル名                    | 説明                           |
|-----------------------------|-------------------------------|
| `setup-services-table.sql`  | 初回セットアップ用スクリプト       |
| `fix-commission-rates.sql`  | 報酬率修正用スクリプト            |
| `README.md`                 | このファイル                    |

---

## 🔗 関連リンク

- [Supabase Dashboard](https://supabase.com/dashboard)
- [環境変数設定ガイド](../.env.example)

---

**最終更新日:** 2025-10-24
