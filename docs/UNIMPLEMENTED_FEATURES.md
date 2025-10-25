# 未実装機能一覧

**調査日**: 2025-10-25
**調査対象**: イケメン代理店管理システム
**調査範囲**: 代理店画面（agency/）、管理画面（admin/）、バックエンドAPI、データベーステーブル

---

## エグゼクティブサマリー

本調査では、イケメン代理店管理システムのフロントエンド、バックエンドAPI、データベーステーブルを横断的に分析し、未実装機能を特定しました。

**主な発見:**
- 代理店画面で2つのAPIエンドポイントが未実装
- 4段階代理店制度のデータベーステーブルは実装済みだが、フロントエンド表示が一部未完成
- 管理画面のバックエンドAPIは全て実装済み
- 未使用のデータベーステーブルが複数存在（TaskMate AI関連機能）

---

## 1. 代理店画面（/agency/）

### 1.1 フロントエンドのみ実装（バックエンドなし）

#### ❌ 階層情報API（4段階代理店制度）
- **場所**: `agency/dashboard.js:1607-1633`
- **説明**: 代理店の親子関係（階層チェーン）と子代理店リストを取得するAPI
- **必要なAPI**: `/.netlify/functions/agency-referral-info`
- **フロントエンドの実装状況**:
  - エラーハンドリング実装済み（404エラーは正常として扱う）
  - 空データで初期化される
- **データベーステーブル**:
  - ✅ `agencies.parent_agency_id` カラム存在
  - ✅ `agencies.level` カラム存在
  - ✅ `get_agency_hierarchy()` 関数実装済み
- **返却すべきデータ構造**:
```javascript
{
  childAgencies: [
    { id, code, name, level, own_commission_rate, created_at }
  ],
  totalChildren: 0,
  hierarchyChain: [
    { agency_id, level, own_commission_rate, parent_agency_id }
  ]
}
```
- **優先度**: **Medium** - 4段階代理店制度の階層可視化に必要だが、コミッション計算には不要

---

#### ❌ コミッション詳細履歴API（4段階代理店制度）
- **場所**: `agency/dashboard.js:1637-1674`
- **説明**: 自己報酬とリファラル報酬の詳細な内訳と履歴を取得するAPI
- **必要なAPI**: `/.netlify/functions/agency-commission-details`
- **フロントエンドの実装状況**:
  - コメントアウト済み（Future implementation）
  - 現在は空配列を返す
  - `loadingCommissions` フラグは実装済み
- **データベーステーブル**:
  - ✅ `agency_commission_distributions` テーブル実装済み
  - ✅ 以下のカラムが存在:
    - `commission_type` (own/referral)
    - `deal_amount` (案件総額)
    - `closing_agency_id` (成約した代理店)
    - `agency_level` (階層レベル)
    - `payment_status` (pending/approved/paid/cancelled)
- **返却すべきデータ構造**:
```javascript
{
  commissionDetails: [
    {
      id,
      conversion_id,
      commission_type, // 'own' or 'referral'
      deal_amount,
      commission_rate,
      commission_amount,
      closing_agency_name, // 成約代理店名
      agency_level,
      payment_status,
      paid_at,
      created_at
    }
  ]
}
```
- **優先度**: **High** - 4段階代理店制度の報酬透明性を確保するために重要

---

### 1.2 表示されているが動作しない機能

#### ⚠️ 報酬タブの「コミッション履歴」ボタン
- **場所**: `agency/index.html:804` - タブボタン
- **説明**: 報酬タブを開くと `loadCommissionHistory()` が呼ばれるが、APIが未実装のため空データが表示される
- **影響**: ユーザーがボタンをクリックしても履歴が表示されない
- **エラー表示**: なし（404エラーを正常として扱う設計）
- **優先度**: **High** - ユーザーが期待する機能が動作しない

---

### 1.3 データベーステーブルはあるが未使用

#### 📊 4段階代理店制度の完全実装
- **テーブル**: `agency_commission_distributions`
- **カラム数**: 12カラム
- **関連機能**:
  - 成約時の報酬自動分配
  - リファラルコミッション計算（固定2%）
  - 階層別報酬率（Level 1: 20%, Level 2: 18%, Level 3: 16%, Level 4: 14%）
- **ヘルパー関数**:
  - ✅ `get_agency_hierarchy(start_agency_id UUID)` - 階層チェーン取得
  - ✅ `get_standard_commission_rate(agency_level INTEGER)` - 標準報酬率取得
- **課題**:
  - フロントエンドに報酬詳細を表示する機能が未実装
  - 報酬分配ロジックのトリガーが未実装（Webhook等）
- **優先度**: **High** - ビジネスモデルの中核機能

---

## 2. 管理画面（/admin/）

### 2.1 フロントエンドのみ実装（バックエンドなし）

**該当なし** - 管理画面で呼ばれている全てのAPIが実装済み:
- ✅ `validate-admin` - 管理者認証
- ✅ `get-tracking-stats` - 統計情報取得
- ✅ `create-tracking-link` - トラッキングリンク作成
- ✅ `admin-agencies` - 代理店管理（GET/POST）

---

### 2.2 表示されているが動作しない機能

**該当なし** - 管理画面の全機能が正常に動作

---

### 2.3 データベーステーブルはあるが未使用

#### 📦 TaskMate AI関連テーブル（システム外機能）

以下のテーブルは、TaskMate AIの会話履歴やコード生成機能で使用されるが、代理店管理システムとは独立している:

1. **conversations** - 会話履歴
2. **conversation_contexts** - 会話コンテキスト
3. **session_checkpoints** - セッションチェックポイント
4. **code_revisions** - コード改訂履歴
5. **code_shares** - コード共有
6. **code_share_access_logs** - アクセスログ
7. **conversation_code_relations** - 会話とコードの関連付け
8. **user_code_history** - ユーザーコード履歴
9. **code_quality_checks** - コード品質チェック
10. **generated_codes** - 生成されたコード
11. **requirement_extractions** - 要件抽出
12. **professional_support_tickets** - プロフェッショナルサポートチケット
13. **vision_usage** - Vision API使用状況

**備考**: これらはTaskMate AIサービス本体で使用されるテーブルであり、代理店管理システムでは直接使用しない。

---

## 3. 相互連携の問題

### 3.1 代理店→管理画面の連携不足

#### ✅ 連携済み
- 代理店登録 → 管理画面で承認
- 代理店トラッキングリンク → 管理画面で統計表示
- 代理店のステータス変更 → リアルタイムで反映

#### ⚠️ 一部未実装
- **4段階代理店制度の階層表示**
  - 管理画面で代理店の親子関係（階層ツリー）を表示する機能が未実装
  - `admin/index.html` に階層表示UIがない
  - `admin-agencies.js` APIは階層データを返していない
  - **優先度**: Medium

---

### 3.2 管理画面→代理店の連携不足

#### ✅ 連携済み
- 管理画面で代理店承認 → 代理店画面でログイン可能
- 管理画面で代理店一時停止 → 代理店画面でログイン不可

#### ❌ 未実装
- **管理画面からの一括通知機能**
  - 管理画面から代理店へのメール通知機能が未実装
  - 承認/非承認時の自動通知がない
  - **必要なテーブル**: notification_logs, email_templates
  - **優先度**: Low

---

## 4. 優先度別実装推奨順序

### High（クリティカル - ビジネス影響大）

#### 1. ✅ コミッション詳細履歴API (`agency-commission-details`)
- **理由**: 4段階代理店制度の報酬透明性確保のため必須
- **工数見積**: 3-5日
- **必要な実装**:
  - API作成: `netlify/functions/agency-commission-details.js`
  - SQL: `agency_commission_distributions` テーブルからデータ取得
  - JOIN: `agencies`, `agency_conversions` テーブル
  - フロントエンド: 既に実装済み（コメントアウトを解除）
- **依存関係**:
  - Stripe Webhookでのコンバージョン記録
  - コミッション分配ロジックの実装

#### 2. 📊 報酬分配トリガーの実装
- **理由**: 4段階代理店制度の自動報酬計算に必須
- **工数見積**: 5-7日
- **必要な実装**:
  - Stripe Webhook (`stripe-webhook.js`) の拡張
  - 階層チェーン取得とコミッション計算ロジック
  - `agency_commission_distributions` への自動INSERT
  - トランザクション処理
- **依存関係**:
  - `get_agency_hierarchy()` 関数（実装済み）
  - `get_standard_commission_rate()` 関数（実装済み）

---

### Medium（重要 - ユーザー体験向上）

#### 3. 🏢 階層情報API (`agency-referral-info`)
- **理由**: 代理店が自分の子代理店を確認できるようにする
- **工数見積**: 2-3日
- **必要な実装**:
  - API作成: `netlify/functions/agency-referral-info.js`
  - SQL: `get_agency_hierarchy()` 関数を使用
  - フロントエンド: 既に実装済み
- **依存関係**: なし（単独で実装可能）

#### 4. 📋 管理画面での階層ツリー表示
- **理由**: 管理者が代理店の親子関係を把握できるようにする
- **工数見積**: 3-4日
- **必要な実装**:
  - `admin-agencies.js` APIの拡張（階層データ追加）
  - `admin/index.html` にツリー表示UI追加
  - JavaScript: 再帰的なツリー構造レンダリング
- **依存関係**: agency-referral-info API

---

### Low（あれば便利）

#### 5. 📧 管理画面からの一括通知機能
- **理由**: 代理店への連絡を効率化
- **工数見積**: 5-7日
- **必要な実装**:
  - テーブル作成: `notification_logs`, `email_templates`
  - API作成: `admin-send-notification.js`
  - メール送信: SendGrid/AWS SES統合
  - フロントエンド: 通知送信UI
- **依存関係**: メール送信サービスの契約

#### 6. 📊 代理店パフォーマンスダッシュボード（管理画面）
- **理由**: 管理者が全代理店のパフォーマンスを一覧で確認
- **工数見積**: 4-5日
- **必要な実装**:
  - API作成: `admin-analytics.js`
  - SQL: 集計クエリ（代理店別売上、CV数、CVR）
  - フロントエンド: Chart.js でグラフ表示
- **依存関係**: なし

---

## 5. 技術的詳細

### 5.1 未実装APIの仕様書

#### API: `agency-referral-info`
```javascript
// GET /.netlify/functions/agency-referral-info
// Headers: Authorization: Bearer {token}, X-Agency-Id: {agencyId}

// Response:
{
  "childAgencies": [
    {
      "id": "uuid",
      "code": "AG001-SUB01",
      "name": "株式会社サブ代理店",
      "level": 2,
      "own_commission_rate": 18.00,
      "created_at": "2025-01-01T00:00:00Z",
      "total_conversions": 10,
      "total_commission": 36000
    }
  ],
  "totalChildren": 1,
  "hierarchyChain": [
    {
      "agency_id": "uuid",
      "level": 1,
      "own_commission_rate": 20.00,
      "parent_agency_id": null
    },
    {
      "agency_id": "uuid",
      "level": 2,
      "own_commission_rate": 18.00,
      "parent_agency_id": "parent-uuid"
    }
  ]
}
```

**実装SQL:**
```sql
-- 子代理店リスト
SELECT
  a.id, a.code, a.name, a.level, a.own_commission_rate, a.created_at,
  COUNT(ac.id) as total_conversions,
  COALESCE(SUM(acd.commission_amount), 0) as total_commission
FROM agencies a
LEFT JOIN agency_conversions ac ON ac.agency_id = a.id
LEFT JOIN agency_commission_distributions acd ON acd.agency_id = a.id
WHERE a.parent_agency_id = $1
GROUP BY a.id;

-- 階層チェーン
SELECT * FROM get_agency_hierarchy($1);
```

---

#### API: `agency-commission-details`
```javascript
// GET /.netlify/functions/agency-commission-details
// Headers: Authorization: Bearer {token}, X-Agency-Id: {agencyId}
// Query Params: ?period_start=2025-01-01&period_end=2025-01-31

// Response:
{
  "commissionDetails": [
    {
      "id": "uuid",
      "conversion_id": "uuid",
      "commission_type": "own", // or "referral"
      "deal_amount": 10000,
      "commission_rate": 20.00,
      "commission_amount": 2000,
      "closing_agency_id": "uuid",
      "closing_agency_name": "株式会社イケメン",
      "agency_level": 1,
      "payment_status": "paid",
      "paid_at": "2025-02-01T00:00:00Z",
      "created_at": "2025-01-15T10:30:00Z",
      "conversion_type": "line_friend",
      "user_email": "user@example.com"
    }
  ],
  "summary": {
    "total_own_commission": 150000,
    "total_referral_commission": 30000,
    "total_paid": 120000,
    "total_pending": 60000,
    "period": "2025年1月"
  }
}
```

**実装SQL:**
```sql
SELECT
  acd.id,
  acd.conversion_id,
  acd.commission_type,
  acd.deal_amount,
  acd.commission_rate,
  acd.commission_amount,
  acd.closing_agency_id,
  closing.name as closing_agency_name,
  acd.agency_level,
  acd.payment_status,
  acd.paid_at,
  acd.created_at,
  ac.conversion_type,
  u.email as user_email
FROM agency_commission_distributions acd
INNER JOIN agencies closing ON closing.id = acd.closing_agency_id
LEFT JOIN agency_conversions ac ON ac.id = acd.conversion_id
LEFT JOIN users u ON u.id = ac.user_id
WHERE acd.agency_id = $1
  AND acd.created_at >= $2
  AND acd.created_at <= $3
ORDER BY acd.created_at DESC;
```

---

### 5.2 データベーステーブル使用状況

| テーブル名 | 使用状況 | 使用箇所 | 備考 |
|-----------|---------|---------|------|
| `agencies` | ✅ 使用中 | 全API | 代理店マスター |
| `agency_users` | ✅ 使用中 | agency-auth | ログイン認証 |
| `agency_tracking_links` | ✅ 使用中 | agency-links, agency-create-link | トラッキングリンク管理 |
| `agency_tracking_visits` | ✅ 使用中 | agency-analytics, track-visit | 訪問記録 |
| `agency_conversions` | ✅ 使用中 | agency-analytics, stripe-webhook | コンバージョン記録 |
| `agency_commissions` | ✅ 使用中 | agency-commissions | 月次報酬集計 |
| `agency_commission_distributions` | ❌ 未使用 | - | **4段階代理店制度の報酬分配** |
| `services` | ✅ 使用中 | agency-services | サービスマスター |
| `agency_service_settings` | ⚠️ 一部使用 | - | サービス別設定（未完全実装） |
| `password_reset_tokens` | ✅ 使用中 | password-reset-request, password-reset-confirm | パスワードリセット |
| `user_sessions` | ❌ 未使用 | - | セッション管理（未実装） |
| `stripe_payments` | ⚠️ 一部使用 | stripe-webhook | Stripe決済記録 |
| `conversations` | ❌ 別システム | TaskMate AI | 代理店システムでは未使用 |
| `code_shares` | ❌ 別システム | TaskMate AI | 代理店システムでは未使用 |

---

## 6. セキュリティ・パフォーマンス懸念事項

### 6.1 セキュリティ
- ✅ JWT認証実装済み
- ✅ Row Level Security (RLS) 実装済み
- ✅ CSRF保護実装済み
- ⚠️ レート制限が一部のエンドポイントで未実装
  - `agency-referral-info` (未作成)
  - `agency-commission-details` (未作成)

### 6.2 パフォーマンス
- ✅ インデックス作成済み（主要テーブル）
- ✅ 再帰クエリ最適化済み (`get_agency_hierarchy`)
- ⚠️ N+1クエリの可能性（`agency-commission-details` でJOIN多数）
  - 推奨: JOINの最適化とEXPLAIN ANALYZE実施

---

## 7. 推奨アクションプラン

### Phase 1: クリティカル機能実装（2-3週間）
1. ✅ `agency-commission-details` API実装
2. ✅ Stripe Webhookでの報酬分配ロジック実装
3. ✅ フロントエンドのコメントアウト解除とテスト

### Phase 2: ユーザー体験向上（1-2週間）
4. ✅ `agency-referral-info` API実装
5. ✅ 管理画面での階層ツリー表示

### Phase 3: 運用効率化（2-3週間）
6. ✅ 一括通知機能実装
7. ✅ 管理画面パフォーマンスダッシュボード

---

## 8. まとめ

### 実装済み機能（高評価ポイント）
- ✅ 代理店認証・登録システム
- ✅ トラッキングリンク管理
- ✅ LINE連携
- ✅ 訪問分析・コンバージョン記録
- ✅ 基本的な報酬計算
- ✅ 管理画面での代理店承認フロー
- ✅ 4段階代理店制度のデータベース設計

### 未実装機能（改善が必要）
- ❌ 4段階代理店制度のフロントエンド表示
- ❌ 報酬分配の自動化
- ❌ 階層情報APIとコミッション詳細API

### ビジネスインパクト
- **High**: 4段階代理店制度が完全稼働していないため、リファラル報酬が支払われていない可能性
- **Medium**: 代理店が自分の子代理店を確認できないため、営業活動が制限される
- **Low**: 管理者の運用負荷が高い（手動通知、手動集計）

---

**調査担当**: Claude (Anthropic)
**調査完了日**: 2025-10-25
