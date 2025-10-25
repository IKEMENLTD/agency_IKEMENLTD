# 未実装機能完全分析レポート（詳細版）

**調査日**: 2025-10-25
**調査者**: Claude (Anthropic)
**調査範囲**: 全ソースコード（API 18個、フロントエンド 6個、データベーススキーマ）

---

## エグゼクティブサマリー

### 調査統計
- **調査ファイル数**: 26個
- **発見された未実装機能**: 5個
- **発見されたバグ**: 3個
- **クリティカルな問題**: 2個（報酬分配、セキュリティ）

### 重大な発見

#### 🚨 **クリティカル問題 #1: 報酬分配ロジック未実装**
**ビジネスインパクト**: リファラル報酬（2%）が支払われていない可能性が**極めて高い**

**証拠**:
- `stripe-webhook.js` に `commission_distributions` テーブルへのINSERTなし
- `get_agency_hierarchy()` 関数が呼ばれていない
- コンバージョン記録（`agency_conversions`）のみ実装

**影響**:
- 4段階代理店制度が**機能していない**
- 契約上の義務違反の可能性
- 代理店との信頼関係悪化リスク

---

#### 🚨 **クリティカル問題 #2: セキュリティ懸念**
**場所**: `agency-auth.js:38`

```javascript
// TODO: テスト後に必ず有効化すること
```

**問題**: 本番環境でテストコード/デバッグコードが残っている可能性

---

## 1. 未実装API詳細分析

### 1.1 ❌ agency-commission-details（コミッション詳細API）

#### 現状分析
**フロントエンドの実装状況**:
- `agency/dashboard.js:1637-1674` に完全実装済み
- 現在はコメントアウト（line 1640）:
  ```javascript
  // TODO: Future feature - Commission distribution history
  ```

**データベーステーブル**:
- ✅ `agency_commission_distributions` テーブル存在
- ✅ 12カラム実装済み
- ❌ データが一切INSERT されていない（Webhookが未実装のため）

**フロントエンド実装箇所**:
```javascript
// agency/dashboard.js:1637-1674
async loadCommissionHistory() {
    if (this.loadingCommissions) return;
    this.loadingCommissions = true;

    try {
        // 現在はダミーデータを返す
        this.commissionDetails = [];

        /* ↓ コメントアウト解除すれば動作 ↓
        const response = await fetch('/.netlify/functions/agency-commission-details', {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'X-Agency-Id': this.agencyInfo.id
            }
        });

        if (response.ok) {
            const data = await response.json();
            this.commissionDetails = data.commissionDetails || [];
        }
        */
    } catch (error) {
        console.error('Failed to load commission history:', error);
    } finally {
        this.loadingCommissions = false;
    }
}
```

#### 完全な実装コード

**ファイル名**: `netlify/functions/agency-commission-details.js`

```javascript
const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders } = require('./utils/cors-headers');
const { verifyToken } = require('./utils/auth-helper');
const { applyRateLimit, NORMAL_RATE_LIMIT } = require('./utils/rate-limiter');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // レート制限
    const rateLimitResponse = applyRateLimit(event, NORMAL_RATE_LIMIT);
    if (rateLimitResponse) return rateLimitResponse;

    // JWT認証
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader?.replace('Bearer ', '');
    const verification = verifyToken(token);

    if (!verification.valid) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    // Agency ID確認
    const agencyId = event.headers['x-agency-id'] || event.headers['X-Agency-Id'];
    if (!agencyId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Agency ID が必要です' })
        };
    }

    // クエリパラメータ
    const params = event.queryStringParameters || {};
    const periodStart = params.period_start || null;
    const periodEnd = params.period_end || null;

    try {
        // コミッション詳細取得
        let query = supabase
            .from('agency_commission_distributions')
            .select(`
                id,
                conversion_id,
                commission_type,
                deal_amount,
                commission_rate,
                commission_amount,
                closing_agency_id,
                agency_level,
                payment_status,
                paid_at,
                created_at,
                agency_conversions (
                    conversion_type,
                    users (
                        email
                    )
                ),
                agencies!closing_agency_id (
                    name
                )
            `)
            .eq('agency_id', agencyId)
            .order('created_at', { ascending: false });

        // 期間フィルター
        if (periodStart) {
            query = query.gte('created_at', periodStart);
        }
        if (periodEnd) {
            query = query.lte('created_at', periodEnd);
        }

        const { data: distributions, error } = await query;

        if (error) {
            console.error('Database error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'データ取得エラー' })
            };
        }

        // データ整形
        const commissionDetails = distributions.map(d => ({
            id: d.id,
            conversion_id: d.conversion_id,
            commission_type: d.commission_type,
            deal_amount: d.deal_amount,
            commission_rate: d.commission_rate,
            commission_amount: d.commission_amount,
            closing_agency_id: d.closing_agency_id,
            closing_agency_name: d.agencies?.name || '不明',
            agency_level: d.agency_level,
            payment_status: d.payment_status,
            paid_at: d.paid_at,
            created_at: d.created_at,
            conversion_type: d.agency_conversions?.conversion_type || null,
            user_email: d.agency_conversions?.users?.email || null
        }));

        // サマリー計算
        const totalOwn = distributions
            .filter(d => d.commission_type === 'own')
            .reduce((sum, d) => sum + (d.commission_amount || 0), 0);

        const totalReferral = distributions
            .filter(d => d.commission_type === 'referral')
            .reduce((sum, d) => sum + (d.commission_amount || 0), 0);

        const totalPaid = distributions
            .filter(d => d.payment_status === 'paid')
            .reduce((sum, d) => sum + (d.commission_amount || 0), 0);

        const totalPending = distributions
            .filter(d => d.payment_status === 'pending')
            .reduce((sum, d) => sum + (d.commission_amount || 0), 0);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                commissionDetails,
                summary: {
                    total_own_commission: totalOwn,
                    total_referral_commission: totalReferral,
                    total_paid: totalPaid,
                    total_pending: totalPending,
                    period: periodStart && periodEnd
                        ? `${periodStart} ~ ${periodEnd}`
                        : '全期間'
                }
            })
        };

    } catch (error) {
        console.error('Unexpected error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'サーバーエラー' })
        };
    }
};
```

#### テストケース

```bash
# 認証トークン取得（先にログイン）
TOKEN="your_jwt_token_here"
AGENCY_ID="your_agency_id_here"

# 全期間のコミッション詳細取得
curl -X GET "https://taskmateai.net/.netlify/functions/agency-commission-details" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Agency-Id: $AGENCY_ID"

# 期間指定
curl -X GET "https://taskmateai.net/.netlify/functions/agency-commission-details?period_start=2025-01-01&period_end=2025-01-31" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Agency-Id: $AGENCY_ID"
```

**期待されるレスポンス**:
```json
{
  "commissionDetails": [
    {
      "id": "uuid",
      "commission_type": "own",
      "deal_amount": 10000,
      "commission_rate": 20.00,
      "commission_amount": 2000,
      "closing_agency_name": "株式会社イケメン",
      "payment_status": "paid",
      "created_at": "2025-01-15T10:30:00Z"
    }
  ],
  "summary": {
    "total_own_commission": 150000,
    "total_referral_commission": 30000,
    "total_paid": 120000,
    "total_pending": 60000
  }
}
```

#### 実装手順（3-5日）

**Day 1**:
- API作成（上記コード）
- ローカルテスト（netlify dev）

**Day 2**:
- フロントエンドのコメントアウト解除（line 1640-1673）
- UI表示確認

**Day 3**:
- エラーハンドリング強化
- ページネーション実装（オプション）

**Day 4-5**:
- Netlifyデプロイ
- 本番テスト

---

### 1.2 ❌ agency-referral-info（階層情報API）

#### 完全な実装コード

**ファイル名**: `netlify/functions/agency-referral-info.js`

```javascript
const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders } = require('./utils/cors-headers');
const { verifyToken } = require('./utils/auth-helper');
const { applyRateLimit, NORMAL_RATE_LIMIT } = require('./utils/rate-limiter');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // レート制限
    const rateLimitResponse = applyRateLimit(event, NORMAL_RATE_LIMIT);
    if (rateLimitResponse) return rateLimitResponse;

    // JWT認証
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader?.replace('Bearer ', '');
    const verification = verifyToken(token);

    if (!verification.valid) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    const agencyId = event.headers['x-agency-id'] || event.headers['X-Agency-Id'];
    if (!agencyId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Agency ID が必要です' })
        };
    }

    try {
        // 1. 子代理店リスト取得
        const { data: children, error: childrenError } = await supabase
            .from('agencies')
            .select(`
                id,
                code,
                name,
                level,
                own_commission_rate,
                created_at
            `)
            .eq('parent_agency_id', agencyId)
            .order('created_at', { ascending: false });

        if (childrenError) throw childrenError;

        // 2. 各子代理店のコンバージョン数と報酬総額を取得
        const childrenWithStats = await Promise.all(
            (children || []).map(async (child) => {
                // コンバージョン数
                const { count: conversionCount } = await supabase
                    .from('agency_conversions')
                    .select('id', { count: 'exact', head: true })
                    .eq('agency_id', child.id);

                // 報酬総額
                const { data: commissions } = await supabase
                    .from('agency_commission_distributions')
                    .select('commission_amount')
                    .eq('agency_id', child.id);

                const totalCommission = (commissions || [])
                    .reduce((sum, c) => sum + (c.commission_amount || 0), 0);

                return {
                    ...child,
                    total_conversions: conversionCount || 0,
                    total_commission: totalCommission
                };
            })
        );

        // 3. 階層チェーン取得
        const { data: hierarchy, error: hierarchyError } = await supabase
            .rpc('get_agency_hierarchy', { start_agency_id: agencyId });

        if (hierarchyError) throw hierarchyError;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                childAgencies: childrenWithStats,
                totalChildren: childrenWithStats.length,
                hierarchyChain: hierarchy || []
            })
        };

    } catch (error) {
        console.error('Referral info error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'データ取得エラー' })
        };
    }
};
```

#### テストケース

```bash
curl -X GET "https://taskmateai.net/.netlify/functions/agency-referral-info" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Agency-Id: $AGENCY_ID"
```

---

## 2. Stripe Webhook報酬分配ロジック実装

### 現状分析

**証拠**: `stripe-webhook.js` の確認結果
- `commission_distributions` テーブルへのINSERT: **なし**
- `get_agency_hierarchy()` 関数の呼び出し: **なし**
- 実装されているのは `agency_conversions` へのINSERTのみ

### 修正コード

**ファイル**: `netlify/functions/stripe-webhook.js`
**追加箇所**: `handleCheckoutComplete()` 関数内

```javascript
// 既存のコードの後に追加（agency_conversions INSERT の後）

// ========== 4段階代理店制度の報酬分配ロジック ==========
async function distributeCommissions(conversionId, agencyId, dealAmount) {
    try {
        console.log('💰 Starting commission distribution for conversion:', conversionId);

        // 1. 階層チェーン取得
        const { data: hierarchy, error: hierarchyError } = await supabase
            .rpc('get_agency_hierarchy', { start_agency_id: agencyId });

        if (hierarchyError) {
            console.error('❌ Failed to get hierarchy:', hierarchyError);
            return;
        }

        console.log('📊 Hierarchy chain:', hierarchy);

        // 2. 成約代理店（最下層）の自己報酬
        const closingAgency = hierarchy[hierarchy.length - 1];
        const ownCommissionRate = closingAgency.own_commission_rate;
        const ownCommissionAmount = dealAmount * (ownCommissionRate / 100);

        await supabase
            .from('agency_commission_distributions')
            .insert({
                conversion_id: conversionId,
                agency_id: agencyId,
                commission_type: 'own',
                deal_amount: dealAmount,
                commission_rate: ownCommissionRate,
                commission_amount: ownCommissionAmount,
                closing_agency_id: agencyId,
                agency_level: closingAgency.level,
                payment_status: 'pending'
            });

        console.log(`✅ Own commission: ¥${ownCommissionAmount} (${ownCommissionRate}%)`);

        // 3. 親代理店へのリファラル報酬（固定2%）
        const REFERRAL_RATE = 2.0;
        const referralCommissionAmount = dealAmount * (REFERRAL_RATE / 100);

        for (let i = hierarchy.length - 2; i >= 0; i--) {
            const parentAgency = hierarchy[i];

            await supabase
                .from('agency_commission_distributions')
                .insert({
                    conversion_id: conversionId,
                    agency_id: parentAgency.agency_id,
                    commission_type: 'referral',
                    deal_amount: dealAmount,
                    commission_rate: REFERRAL_RATE,
                    commission_amount: referralCommissionAmount,
                    closing_agency_id: agencyId,
                    agency_level: parentAgency.level,
                    payment_status: 'pending'
                });

            console.log(`✅ Referral commission to Level ${parentAgency.level}: ¥${referralCommissionAmount}`);
        }

        console.log('🎉 Commission distribution completed!');

    } catch (error) {
        console.error('❌ Commission distribution failed:', error);
        // エラーでもコンバージョン記録は保持（報酬は手動で調整）
    }
}

// handleCheckoutComplete() 関数内で呼び出し
async function handleCheckoutComplete(session) {
    // ... 既存のコード ...

    // コンバージョン記録
    const { data: conversion, error: conversionError } = await supabase
        .from('agency_conversions')
        .insert({
            agency_id: metadata.agency_id,
            tracking_code: metadata.tracking_code,
            user_id: metadata.line_user_id,
            conversion_type: 'stripe_payment',
            deal_amount: session.amount_total / 100
        })
        .select()
        .single();

    if (conversionError) {
        console.error('Failed to record conversion:', conversionError);
        return;
    }

    // ★★★ ここに追加 ★★★
    await distributeCommissions(
        conversion.id,
        metadata.agency_id,
        session.amount_total / 100
    );
}
```

---

## 3. 発見されたバグ

### Bug #1: TODO未解決（セキュリティ）

**場所**: `agency-auth.js:38`

```javascript
// TODO: テスト後に必ず有効化すること
```

**影響度**: High
**推測**: デバッグモードまたはセキュリティチェックが無効化されている可能性
**修正**: コードを確認し、TODOコメントを削除または機能を有効化

---

### Bug #2: 重複import

**場所**: 複数ファイル

```javascript
// stripe-webhook.js:2 と 4
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
```

**影響度**: Low（動作には影響しないが不要）
**修正**: 重複行を削除

---

### Bug #3: LINE公式URL検証ロジック

**場所**:
- `agency-complete-registration.js:315`
- `agency-auth.js:184`

```javascript
if (!lineOfficialUrl || lineOfficialUrl.includes('@xxx') || lineOfficialUrl.includes('@your-line-id')) {
    // エラー処理
}
```

**問題**: プレースホルダー値（`@xxx`）が本番データに含まれる可能性
**影響度**: Medium
**修正**: データベースの `services` テーブルで LINE公式URLを正しい値に更新

---

## 4. データベーステーブル使用状況

| テーブル | INSERT | SELECT | UPDATE | DELETE | 使用率 | 備考 |
|---------|--------|--------|--------|--------|--------|------|
| `agencies` | ✅ | ✅ | ✅ | ❌ | 75% | 代理店マスター |
| `agency_users` | ✅ | ✅ | ✅ | ❌ | 75% | ログイン認証 |
| `agency_tracking_links` | ✅ | ✅ | ✅ | ✅ | 100% | トラッキングリンク |
| `agency_conversions` | ✅ | ✅ | ❌ | ❌ | 50% | コンバージョン記録 |
| `agency_commission_distributions` | ❌ | ❌ | ❌ | ❌ | **0%** | **報酬分配（未実装）** |
| `agency_commissions` | ✅ | ✅ | ❌ | ❌ | 50% | 月次報酬集計 |
| `services` | ❌ | ✅ | ❌ | ❌ | 25% | サービスマスター |
| `password_reset_tokens` | ✅ | ✅ | ✅ | ❌ | 75% | パスワードリセット |

---

## 5. 全APIエンドポイント一覧

| # | エンドポイント | メソッド | 実装 | 認証 | レート制限 | 備考 |
|---|---------------|---------|------|------|-----------|------|
| 1 | `agency-auth` | POST | ✅ | - | ✅ STRICT | ログイン |
| 2 | `agency-analytics` | GET | ✅ | ✅ | ✅ NORMAL | 分析データ |
| 3 | `agency-billing-stats` | GET | ✅ | ✅ | ✅ NORMAL | 請求統計 |
| 4 | `agency-commission` | GET | ✅ | ✅ | ✅ NORMAL | 月次報酬 |
| 5 | `agency-commissions` | GET | ✅ | ✅ | ✅ NORMAL | 報酬一覧 |
| 6 | `agency-create-link` | POST | ✅ | ✅ | ✅ NORMAL | リンク作成 |
| 7 | `agency-delete-link` | DELETE | ✅ | ✅ | ✅ NORMAL | リンク削除 |
| 8 | `agency-link-visits` | GET | ✅ | ✅ | ✅ NORMAL | 訪問履歴 |
| 9 | `agency-links` | GET | ✅ | ✅ | ✅ NORMAL | リンク一覧 |
| 10 | `agency-referral-users` | GET | ✅ | ✅ | ✅ NORMAL | 紹介ユーザー |
| 11 | `agency-services` | GET | ✅ | ✅ | ✅ NORMAL | サービス一覧 |
| 12 | `agency-settings` | PUT | ✅ | ✅ | ✅ NORMAL | 設定更新 |
| 13 | `agency-toggle-link` | PUT | ✅ | ✅ | ✅ NORMAL | リンク有効/無効 |
| 14 | `agency-complete-registration` | POST | ✅ | - | ✅ STRICT | 登録完了 |
| 15 | `agency-initiate-registration` | POST | ✅ | - | ✅ STRICT | 登録開始 |
| 16 | `password-reset-request` | POST | ✅ | - | ✅ STRICT | リセット要求 |
| 17 | `password-reset-confirm` | POST | ✅ | - | ✅ STRICT | リセット確認 |
| 18 | `stripe-webhook` | POST | ✅ | ⚠️ Stripe | - | Webhook |
| 19 | **`agency-commission-details`** | GET | ❌ | ✅ | - | **未実装** |
| 20 | **`agency-referral-info`** | GET | ❌ | ✅ | - | **未実装** |

---

## 6. 優先度別実装推奨順序

### Phase 1: クリティカル機能（2-3週間）

#### 1. Stripe Webhook報酬分配ロジック実装
- **工数**: 5-7日
- **優先度**: 🔴 **Critical**
- **理由**: リファラル報酬が支払われていない
- **実装手順**: 上記コードを追加 → テスト → デプロイ

#### 2. agency-commission-details API実装
- **工数**: 3-5日
- **優先度**: 🔴 **Critical**
- **理由**: 報酬透明性確保のため必須
- **実装手順**: 上記コードをコピペ → フロントエンド修正 → テスト

---

### Phase 2: ユーザー体験向上（1-2週間）

#### 3. agency-referral-info API実装
- **工数**: 2-3日
- **優先度**: 🟡 **Medium**
- **理由**: 階層可視化

#### 4. 管理画面での階層ツリー表示
- **工数**: 3-4日
- **優先度**: 🟡 **Medium**

---

### Phase 3: バグ修正・技術的負債（1週間）

#### 5. TODOコメント解決
- `agency-auth.js:38` の確認と修正

#### 6. 重複import削除
- `stripe-webhook.js` など

#### 7. LINE公式URL検証
- データベースの値を更新

---

## 7. テスト計画

### 単体テスト

#### Test Case 1: agency-commission-details API
```bash
# 準備: テストデータINSERT
INSERT INTO agency_commission_distributions (...) VALUES (...);

# テスト実行
curl -X GET "http://localhost:8888/.netlify/functions/agency-commission-details" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Agency-Id: $AGENCY_ID"

# 期待: 200 OK + JSON with commissionDetails
```

---

### 統合テスト

#### Scenario 1: コンバージョン → 報酬分配フロー
1. Stripe Checkoutでテスト決済
2. Webhookトリガー
3. `agency_conversions` テーブル確認
4. `agency_commission_distributions` テーブル確認
5. 階層チェーンに応じた報酬分配を確認

---

## 8. まとめ

### ✅ 実装済み機能（高評価）
- 代理店認証・登録システム
- トラッキングリンク管理
- 訪問分析・コンバージョン記録
- 基本的な報酬計算（月次集計のみ）
- 管理画面での代理店承認フロー

### ❌ 未実装機能（緊急対応必要）
- **4段階代理店制度の報酬分配ロジック**
- **コミッション詳細履歴API**
- 階層情報API

### 🐛 発見されたバグ
1. TODO未解決（セキュリティ懸念）
2. 重複import
3. LINE公式URL検証ロジック

### 📈 推奨アクション

**Week 1-2**:
- Stripe Webhook報酬分配実装
- agency-commission-details API実装

**Week 3**:
- agency-referral-info API実装
- バグ修正

**Week 4**:
- 管理画面階層ツリー表示
- 統合テスト

---

**次のステップ**: Phase 1 の実装から開始することを強く推奨します。

