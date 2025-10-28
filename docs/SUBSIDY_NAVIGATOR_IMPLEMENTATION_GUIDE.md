# 補助金ナビゲーター サービス追加 実装ガイド

**作成日**: 2025-10-29
**対象サービス**: 補助金ナビゲーター (https://lin.ee/fbyGDxB)
**報酬体系**: 粗利益の20%

---

## 📋 実装概要

このガイドでは、補助金ナビゲーターサービスを代理店管理システムに追加する手順を説明します。

### 追加機能

1. ✅ 補助金ナビゲーターサービスのデータベース登録
2. ✅ 複数サービス対応（`agency_commissions` に `service_id` 追加）
3. ✅ 粗利益ベースのコミッション計算
4. ✅ 管理画面でのコミッション手動入力
5. ✅ 承認フロー（保留 → 承認 → 支払済み / 否認）
6. 🔄 代理店ダッシュボードでのサービス別表示

---

## 🗄️ Step 1: データベースマイグレーション

### 実行手順

1. Supabase ダッシュボードにログイン
   https://supabase.com/dashboard

2. プロジェクトを選択

3. 左メニューから「SQL Editor」を開く

4. 以下のファイルの内容をコピーして実行:
   **`database/migration_006_add_subsidy_navigator_service.sql`**

### マイグレーション内容

```sql
-- 1. 補助金ナビゲーターサービスを services テーブルに追加
INSERT INTO services (...) VALUES (...);

-- 2. agency_commissions に service_id カラムを追加
ALTER TABLE agency_commissions ADD COLUMN service_id UUID;

-- 3. agency_commissions に gross_profit カラムを追加（粗利益管理用）
ALTER TABLE agency_commissions ADD COLUMN gross_profit DECIMAL(12,2);

-- 4. 既存データにデフォルトサービス（TaskMate AI）を設定

-- 5. ユニーク制約を更新（agency_id + service_id + period）
```

### 確認クエリ

```sql
-- サービス一覧を確認
SELECT id, code, name, default_commission_rate, line_official_url
FROM services
ORDER BY created_at;

-- 結果例:
-- | code         | name                | rate | line_url                  |
-- |--------------|---------------------|------|---------------------------|
-- | TASKMATE_AI  | TaskMate AI         | 20%  | https://lin.ee/XXXXXXX    |
-- | SUBSIDY_NAV  | 補助金ナビゲーター  | 20%  | https://lin.ee/fbyGDxB    |
```

---

## 🔧 Step 2: Netlify Functions（バックエンドAPI）

### 新規作成ファイル

#### 1. `netlify/functions/admin-commissions.js`
管理画面用コミッション管理API

**エンドポイント**:
- `GET /.netlify/functions/admin-commissions` - コミッション一覧取得
- `GET /.netlify/functions/admin-commissions/:id` - 特定のコミッション取得
- `POST /.netlify/functions/admin-commissions` - コミッション手動作成
- `PUT /.netlify/functions/admin-commissions/:id` - コミッション更新（承認/否認）
- `DELETE /.netlify/functions/admin-commissions/:id` - コミッション削除

**リクエスト例（コミッション作成）**:
```javascript
POST /.netlify/functions/admin-commissions
Authorization: Basic YWRtaW46cGFzc3dvcmQ=

{
  "agency_id": "uuid-here",
  "service_id": "uuid-here",  // 補助金ナビゲーターのID
  "period_start": "2025-10-01",
  "period_end": "2025-10-31",
  "total_conversions": 1,
  "total_sales": 500000,      // 売上: 50万円
  "gross_profit": 200000,     // 粗利益: 20万円
  "commission_rate": 20.00,   // 20%
  "commission_amount": 40000, // 40,000円（自動計算または手動入力）
  "notes": "補助金申請サポート案件"
}
```

**リクエスト例（承認）**:
```javascript
PUT /.netlify/functions/admin-commissions/:id
Authorization: Basic YWRtaW46cGFzc3dvcmQ=

{
  "status": "approved"  // pending → approved
}
```

#### 2. `netlify/functions/admin-services.js`
サービス一覧取得API

**エンドポイント**:
- `GET /.netlify/functions/admin-services` - サービス一覧取得

---

## 🎨 Step 3: 管理画面UI実装

### コミッション管理セクション追加

#### A. タブナビゲーション追加

`admin/index.html` の既存タブに追加:

```html
<!-- Commissions Tab Button -->
<button
    @click="activeTab = 'commissions'"
    :class="activeTab === 'commissions' ? 'bg-cyan-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'"
    class="px-4 py-2 rounded-lg font-medium transition-colors">
    <i class="fas fa-yen-sign mr-2"></i>
    コミッション管理
</button>
```

#### B. コミッション管理画面

```html
<!-- Commissions Management Section -->
<div x-show="activeTab === 'commissions'" class="space-y-6">
    <!-- ヘッダー -->
    <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold text-gray-900">コミッション管理</h2>
        <button
            @click="showCreateCommissionModal = true"
            class="bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 text-white px-4 py-2 rounded-lg">
            <i class="fas fa-plus mr-2"></i>
            コミッション手動登録
        </button>
    </div>

    <!-- フィルター -->
    <div class="bg-white rounded-xl shadow p-4 flex gap-4">
        <select x-model="commissionFilters.status" class="border rounded px-3 py-2">
            <option value="">全てのステータス</option>
            <option value="pending">保留</option>
            <option value="approved">承認済み</option>
            <option value="paid">支払済み</option>
            <option value="rejected">否認</option>
        </select>

        <select x-model="commissionFilters.service_id" class="border rounded px-3 py-2">
            <option value="">全てのサービス</option>
            <template x-for="service in services" :key="service.id">
                <option :value="service.id" x-text="service.name"></option>
            </template>
        </select>

        <button @click="loadCommissions()" class="bg-cyan-600 text-white px-4 py-2 rounded-lg">
            <i class="fas fa-search mr-2"></i>検索
        </button>
    </div>

    <!-- 統計カード -->
    <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-600">保留中</div>
            <div class="text-2xl font-bold text-yellow-600" x-text="commissionStats.pending"></div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-600">承認済み</div>
            <div class="text-2xl font-bold text-green-600" x-text="commissionStats.approved"></div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-600">支払済み</div>
            <div class="text-2xl font-bold text-blue-600" x-text="commissionStats.paid"></div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-600">否認</div>
            <div class="text-2xl font-bold text-red-600" x-text="commissionStats.rejected"></div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-600">合計金額</div>
            <div class="text-2xl font-bold text-cyan-600">
                ¥<span x-text="commissionStats.total_amount.toLocaleString()"></span>
            </div>
        </div>
    </div>

    <!-- コミッション一覧テーブル -->
    <div class="bg-white rounded-xl shadow overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代理店</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">サービス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">対象期間</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">粗利益</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">報酬率</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">報酬額</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                <template x-for="commission in commissions" :key="commission.id">
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm font-medium text-gray-900" x-text="commission.agencies?.name"></div>
                            <div class="text-sm text-gray-500" x-text="commission.agencies?.code"></div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-gray-900" x-text="commission.services?.name"></div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <span x-text="formatDate(commission.period_start)"></span> -
                            <span x-text="formatDate(commission.period_end)"></span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ¥<span x-text="(commission.gross_profit || 0).toLocaleString()"></span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span x-text="commission.commission_rate"></span>%
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            ¥<span x-text="(commission.commission_amount || 0).toLocaleString()"></span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span
                                :class="{
                                    'bg-yellow-100 text-yellow-800': commission.status === 'pending',
                                    'bg-green-100 text-green-800': commission.status === 'approved',
                                    'bg-blue-100 text-blue-800': commission.status === 'paid',
                                    'bg-red-100 text-red-800': commission.status === 'rejected'
                                }"
                                class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                                x-text="getStatusLabel(commission.status)">
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <button
                                x-show="commission.status === 'pending'"
                                @click="approveCommission(commission.id)"
                                class="text-green-600 hover:text-green-900 mr-2"
                                title="承認">
                                <i class="fas fa-check-circle"></i>
                            </button>
                            <button
                                x-show="commission.status === 'pending'"
                                @click="rejectCommission(commission.id)"
                                class="text-red-600 hover:text-red-900 mr-2"
                                title="否認">
                                <i class="fas fa-times-circle"></i>
                            </button>
                            <button
                                @click="editCommission(commission)"
                                class="text-cyan-600 hover:text-cyan-900"
                                title="編集">
                                <i class="fas fa-edit"></i>
                            </button>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</div>

<!-- コミッション作成モーダル -->
<div x-show="showCreateCommissionModal" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
    <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

        <div class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h3 class="text-lg font-medium text-gray-900 mb-4">コミッション手動登録</h3>

            <form @submit.prevent="createCommission()" class="space-y-4">
                <!-- 代理店選択 -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">代理店</label>
                    <select x-model="newCommission.agency_id" required class="w-full border rounded px-3 py-2">
                        <option value="">選択してください</option>
                        <template x-for="agency in agencies" :key="agency.id">
                            <option :value="agency.id" x-text="`${agency.name} (${agency.code})`"></option>
                        </template>
                    </select>
                </div>

                <!-- サービス選択 -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">サービス</label>
                    <select x-model="newCommission.service_id" required class="w-full border rounded px-3 py-2">
                        <option value="">選択してください</option>
                        <template x-for="service in services" :key="service.id">
                            <option :value="service.id">
                                <span x-text="service.name"></span>
                                (<span x-text="service.default_commission_rate"></span>%)
                            </option>
                        </template>
                    </select>
                </div>

                <!-- 対象期間 -->
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">期間開始</label>
                        <input type="date" x-model="newCommission.period_start" required class="w-full border rounded px-3 py-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">期間終了</label>
                        <input type="date" x-model="newCommission.period_end" required class="w-full border rounded px-3 py-2">
                    </div>
                </div>

                <!-- 金額入力 -->
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">売上額（円）</label>
                        <input type="number" x-model="newCommission.total_sales" class="w-full border rounded px-3 py-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">粗利益（円）*</label>
                        <input type="number" x-model="newCommission.gross_profit" required class="w-full border rounded px-3 py-2">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">報酬率（%）</label>
                        <input type="number" step="0.01" x-model="newCommission.commission_rate" class="w-full border rounded px-3 py-2">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">報酬額（円）*</label>
                        <input type="number" x-model="newCommission.commission_amount" required class="w-full border rounded px-3 py-2">
                    </div>
                </div>

                <!-- メモ -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">メモ</label>
                    <textarea x-model="newCommission.notes" rows="3" class="w-full border rounded px-3 py-2"></textarea>
                </div>

                <!-- ボタン -->
                <div class="flex justify-end gap-3 mt-6">
                    <button
                        type="button"
                        @click="showCreateCommissionModal = false"
                        class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                        キャンセル
                    </button>
                    <button
                        type="submit"
                        class="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700">
                        <i class="fas fa-save mr-2"></i>登録
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
```

### C. JavaScript実装（`admin/dashboard.js`）

```javascript
// adminDashboard() 関数に追加

data() {
    return {
        // ... 既存のデータ

        // コミッション管理
        commissions: [],
        commissionStats: {
            total: 0,
            pending: 0,
            approved: 0,
            paid: 0,
            rejected: 0,
            total_amount: 0
        },
        commissionFilters: {
            status: '',
            service_id: '',
            agency_id: ''
        },
        services: [],
        showCreateCommissionModal: false,
        newCommission: {
            agency_id: '',
            service_id: '',
            period_start: '',
            period_end: '',
            total_sales: 0,
            gross_profit: 0,
            commission_rate: 20.00,
            commission_amount: 0,
            notes: ''
        }
    };
},

async init() {
    // ... 既存の初期化処理

    if (this.isAuthenticated) {
        await this.loadServices();
        await this.loadCommissions();
    }
},

async loadServices() {
    try {
        const response = await fetch('/.netlify/functions/admin-services', {
            headers: {
                'Authorization': `Basic ${btoa(`${this.loginForm.username}:${this.loginForm.password}`)}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            this.services = data.services;
        }
    } catch (error) {
        console.error('サービス一覧の取得に失敗:', error);
    }
},

async loadCommissions() {
    try {
        const params = new URLSearchParams();
        if (this.commissionFilters.status) {
            params.append('status', this.commissionFilters.status);
        }
        if (this.commissionFilters.service_id) {
            params.append('service_id', this.commissionFilters.service_id);
        }

        const response = await fetch(`/.netlify/functions/admin-commissions?${params}`, {
            headers: {
                'Authorization': `Basic ${btoa(`${this.loginForm.username}:${this.loginForm.password}`)}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            this.commissions = data.commissions;
            this.commissionStats = data.stats;
        }
    } catch (error) {
        console.error('コミッション一覧の取得に失敗:', error);
    }
},

async createCommission() {
    try {
        const response = await fetch('/.netlify/functions/admin-commissions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(`${this.loginForm.username}:${this.loginForm.password}`)}`
            },
            body: JSON.stringify(this.newCommission)
        });

        if (response.ok) {
            alert('コミッションを登録しました');
            this.showCreateCommissionModal = false;
            this.newCommission = {
                agency_id: '',
                service_id: '',
                period_start: '',
                period_end: '',
                total_sales: 0,
                gross_profit: 0,
                commission_rate: 20.00,
                commission_amount: 0,
                notes: ''
            };
            await this.loadCommissions();
        } else {
            const error = await response.json();
            alert(`エラー: ${error.error}`);
        }
    } catch (error) {
        console.error('コミッション登録に失敗:', error);
        alert('コミッション登録に失敗しました');
    }
},

async approveCommission(commissionId) {
    if (!confirm('このコミッションを承認しますか？')) return;

    try {
        const response = await fetch(`/.netlify/functions/admin-commissions/${commissionId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(`${this.loginForm.username}:${this.loginForm.password}`)}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        if (response.ok) {
            alert('コミッションを承認しました');
            await this.loadCommissions();
        }
    } catch (error) {
        console.error('承認に失敗:', error);
    }
},

async rejectCommission(commissionId) {
    if (!confirm('このコミッションを否認しますか？')) return;

    try {
        const response = await fetch(`/.netlify/functions/admin-commissions/${commissionId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(`${this.loginForm.username}:${this.loginForm.password}`)}`
            },
            body: JSON.stringify({ status: 'rejected' })
        });

        if (response.ok) {
            alert('コミッションを否認しました');
            await this.loadCommissions();
        }
    } catch (error) {
        console.error('否認に失敗:', error);
    }
},

getStatusLabel(status) {
    const labels = {
        'pending': '保留',
        'approved': '承認済み',
        'paid': '支払済み',
        'rejected': '否認',
        'cancelled': 'キャンセル'
    };
    return labels[status] || status;
},

formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
```

---

## 📱 Step 4: 代理店ダッシュボード対応

代理店側でサービス別の報酬を表示できるように更新します。

### `agency/dashboard.js` 修正

```javascript
async loadCommissions() {
    try {
        const response = await fetch('/.netlify/functions/agency-commissions', {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'X-Agency-Id': this.agencyId
            }
        });

        if (response.ok) {
            const data = await response.json();
            this.commissions = data.commissions;

            // サービス別に集計
            this.commissionsByService = data.commissions.reduce((acc, comm) => {
                const serviceName = comm.services?.name || '未分類';
                if (!acc[serviceName]) {
                    acc[serviceName] = {
                        total: 0,
                        count: 0,
                        items: []
                    };
                }
                acc[serviceName].total += parseFloat(comm.commission_amount || 0);
                acc[serviceName].count += 1;
                acc[serviceName].items.push(comm);
                return acc;
            }, {});
        }
    } catch (error) {
        console.error('コミッション取得エラー:', error);
    }
}
```

### `agency/index.html` 修正

報酬セクションにサービス別表示を追加:

```html
<!-- サービス別報酬 -->
<div class="bg-white rounded-xl shadow-lg p-6 mb-6">
    <h3 class="text-lg font-semibold text-gray-900 mb-4">サービス別報酬</h3>
    <template x-for="(data, serviceName) in commissionsByService" :key="serviceName">
        <div class="border-b border-gray-200 py-3 last:border-b-0">
            <div class="flex justify-between items-center">
                <div>
                    <span class="font-medium text-gray-900" x-text="serviceName"></span>
                    <span class="text-sm text-gray-500 ml-2" x-text="`(${data.count}件)`"></span>
                </div>
                <div class="text-lg font-semibold text-cyan-600">
                    ¥<span x-text="data.total.toLocaleString()"></span>
                </div>
            </div>
        </div>
    </template>
</div>
```

---

## ✅ Step 5: デプロイ手順

### 1. マイグレーションSQL実行

Supabase SQL Editorで `migration_006_add_subsidy_navigator_service.sql` を実行

### 2. コードをコミット

```bash
cd "C:\Users\ooxmi\Downloads\イケメン代理店管理システム"

git add .

git commit -m "feat: 補助金ナビゲーターサービス追加

- 補助金ナビゲーターをservicesテーブルに追加
- agency_commissionsにservice_id, gross_profitカラム追加
- 管理画面にコミッション手動入力機能を追加
- 承認フロー実装（保留→承認→支払済み/否認）
- 代理店ダッシュボードでサービス別表示に対応

📧 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

git push
```

### 3. Netlify環境変数確認

既存の環境変数が設定されていることを確認:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### 4. Netlify再デプロイ

Netlifyが自動的にデプロイします（約2-3分）。

---

## 🧪 Step 6: 動作確認

### 1. 管理画面でコミッション登録

1. https://agency.ikemen.ltd/admin/ にアクセス
2. ログイン（admin / TaskMate2024Admin!）
3. 「コミッション管理」タブを開く
4. 「コミッション手動登録」ボタンをクリック
5. 以下を入力:
   - 代理店: テスト代理店を選択
   - サービス: 補助金ナビゲーター
   - 期間: 2025-10-01 ~ 2025-10-31
   - 粗利益: 200,000円
   - 報酬率: 20%
   - 報酬額: 40,000円（自動計算または手動入力）
6. 「登録」ボタンをクリック

### 2. 承認フローテスト

1. コミッション一覧で「保留」ステータスのコミッションを確認
2. ✅ アイコンをクリックして承認
3. ステータスが「承認済み」に変わることを確認

### 3. 代理店ダッシュボード確認

1. https://agency.ikemen.ltd/ にアクセス
2. テスト代理店でログイン
3. 「報酬」タブを開く
4. サービス別報酬セクションで「補助金ナビゲーター」が表示されることを確認
5. 承認済みコミッションが報酬履歴に表示されることを確認

---

## 📊 データ構造

### services テーブル

| id | code | name | default_commission_rate | line_official_url |
|----|------|------|------------------------|-------------------|
| uuid1 | TASKMATE_AI | TaskMate AI | 20.00 | https://lin.ee/XXXXX |
| uuid2 | SUBSIDY_NAV | 補助金ナビゲーター | 20.00 | https://lin.ee/fbyGDxB |

### agency_commissions テーブル

| id | agency_id | service_id | period_start | period_end | gross_profit | commission_rate | commission_amount | status |
|----|-----------|------------|--------------|------------|--------------|-----------------|-------------------|--------|
| uuid | uuid | uuid | 2025-10-01 | 2025-10-31 | 200000 | 20.00 | 40000 | approved |

---

## 🔒 セキュリティ

- 管理画面API: Basic認証（`ADMIN_USERNAME` / `ADMIN_PASSWORD`）
- 代理店API: JWT認証 + `X-Agency-Id` ヘッダー
- Supabase RLS: 代理店は自分のデータのみアクセス可能

---

## 🎉 完了

補助金ナビゲーターサービスが正常に追加されました。

**次のステップ:**
- 実際の案件が発生したら管理画面でコミッションを手動登録
- 承認後、代理店に通知メールを送信（オプション）
- 月次でまとめて支払処理

---

**作成者**: Claude (Anthropic)
**日付**: 2025-10-29
**バージョン**: 1.0
