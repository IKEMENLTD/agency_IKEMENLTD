#!/bin/bash

# JWT_SECRETのフォールバックを削除するスクリプト

cd "/mnt/c/Users/ooxmi/Downloads/イケメン代理店管理システム/netlify/functions"

# 置換対象のファイル一覧
files=(
    "agency-analytics.js"
    "agency-billing-stats.js"
    "agency-commission.js"
    "agency-commissions.js"
    "agency-create-link.js"
    "agency-delete-link.js"
    "agency-link-visits.js"
    "agency-links.js"
    "agency-referral-users.js"
    "agency-settings.js"
    "agency-toggle-link.js"
)

for file in "${files[@]}"; do
    echo "修正中: $file"

    # バックアップを作成
    cp "$file" "$file.bak"

    # フォールバックを削除
    sed -i "s/process\.env\.JWT_SECRET || 'your-jwt-secret'/process.env.JWT_SECRET/g" "$file"

    echo "✅ 完了: $file"
done

echo ""
echo "全ての修正が完了しました。"
echo "注意: これらのファイルはJWT_SECRET環境変数が必須になりました。"
