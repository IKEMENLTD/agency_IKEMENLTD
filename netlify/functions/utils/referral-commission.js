/**
 * リファラルコミッション計算ユーティリティ
 * 4段階代理店制度のコミッション計算ロジック
 */

const logger = require('./logger');

/**
 * 階層レベルに基づいて標準報酬率を返す
 * @param {number} level - 代理店階層レベル (1-4)
 * @returns {number} 報酬率（パーセンテージ）
 */
function getStandardCommissionRate(level) {
    const rates = {
        1: 20.00,
        2: 18.00,
        3: 16.00,
        4: 14.00
    };
    return rates[level] || 20.00; // デフォルト20%
}

/**
 * コミッション計算関数
 * 案件成約時のコミッションを計算し、全ての関連代理店に分配する
 *
 * @param {Object} supabase - Supabaseクライアント
 * @param {number} dealAmount - 案件総額（円）
 * @param {string} closingAgencyId - 成約させた代理店のID (UUID)
 * @param {string} conversionId - コンバージョン記録のID (UUID)
 * @returns {Promise<Object>} {
 *   success: boolean,
 *   totalCommission: number,
 *   distributions: Array<Object>
 * }
 */
async function calculateCommissions(supabase, dealAmount, closingAgencyId, conversionId) {
    try {
        logger.log('=== コミッション計算開始 ===');
        logger.log('案件総額:', dealAmount);
        logger.log('成約代理店ID:', closingAgencyId);
        logger.log('コンバージョンID:', conversionId);

        // STEP 1: バリデーション
        if (!dealAmount || dealAmount <= 0) {
            throw new Error('案件総額は正の数値である必要があります');
        }

        if (!closingAgencyId) {
            throw new Error('成約代理店IDが指定されていません');
        }

        // STEP 2: 成約代理店の情報を取得
        const { data: closingAgent, error: closingAgentError } = await supabase
            .from('agencies')
            .select('id, code, name, level, own_commission_rate, parent_agency_id, status')
            .eq('id', closingAgencyId)
            .eq('status', 'active')
            .single();

        if (closingAgentError || !closingAgent) {
            logger.error('成約代理店が見つかりません:', closingAgentError);
            throw new Error('成約代理店が見つかりません');
        }

        logger.log('✅ 成約代理店:', closingAgent.name);
        logger.log('   レベル:', closingAgent.level);
        logger.log('   自己報酬率:', closingAgent.own_commission_rate, '%');

        // STEP 3: 報酬分配リストの初期化
        const distributions = [];
        let totalCommission = 0;

        // STEP 4: 成約代理店自身の報酬計算（自己報酬）
        const ownCommissionAmount = Math.floor(dealAmount * (closingAgent.own_commission_rate / 100));
        totalCommission += ownCommissionAmount;

        distributions.push({
            agency_id: closingAgent.id,
            agency_name: closingAgent.name,
            agency_level: closingAgent.level,
            commission_type: 'own',
            commission_rate: closingAgent.own_commission_rate,
            commission_amount: ownCommissionAmount,
            deal_amount: dealAmount
        });

        logger.log('✅ 自己報酬計算完了');
        logger.log('   報酬額: ¥' + ownCommissionAmount.toLocaleString());

        // STEP 5: 上位代理店へのリファラルコミッション計算
        let currentAgency = closingAgent;
        const referralRate = 2.00; // 固定2%
        let depth = 0;
        const maxDepth = 10; // 無限ループ防止

        while (currentAgency.parent_agency_id && depth < maxDepth) {
            depth++;

            logger.log(`=== リファラルコミッション計算 (深さ: ${depth}) ===`);

            // 親代理店の情報を取得
            const { data: parentAgent, error: parentError } = await supabase
                .from('agencies')
                .select('id, code, name, level, parent_agency_id, status')
                .eq('id', currentAgency.parent_agency_id)
                .eq('status', 'active')
                .single();

            if (parentError || !parentAgent) {
                logger.warn('親代理店が見つかりません:', currentAgency.parent_agency_id);
                logger.warn('エラー:', parentError);
                break;
            }

            logger.log('親代理店:', parentAgent.name);
            logger.log('レベル:', parentAgent.level);

            // リファラルコミッション計算
            const referralCommissionAmount = Math.floor(dealAmount * (referralRate / 100));
            totalCommission += referralCommissionAmount;

            distributions.push({
                agency_id: parentAgent.id,
                agency_name: parentAgent.name,
                agency_level: parentAgent.level,
                commission_type: 'referral',
                commission_rate: referralRate,
                commission_amount: referralCommissionAmount,
                deal_amount: dealAmount
            });

            logger.log('✅ リファラル報酬: ¥' + referralCommissionAmount.toLocaleString());

            // 次の親へ
            currentAgency = parentAgent;

            // 1次代理店に到達したら終了
            if (currentAgency.level === 1 && !currentAgency.parent_agency_id) {
                logger.log('1次代理店に到達しました。計算終了。');
                break;
            }
        }

        if (depth >= maxDepth) {
            logger.error('階層が深すぎます（最大10階層）。処理を中断しました。');
        }

        // STEP 6: データベースに報酬分配記録を保存
        logger.log('=== 報酬分配記録の保存開始 ===');

        for (const distribution of distributions) {
            const { error: insertError } = await supabase
                .from('agency_commission_distributions')
                .insert({
                    conversion_id: conversionId,
                    agency_id: distribution.agency_id,
                    closing_agency_id: closingAgencyId,
                    deal_amount: dealAmount,
                    commission_type: distribution.commission_type,
                    commission_rate: distribution.commission_rate,
                    commission_amount: distribution.commission_amount,
                    agency_level: distribution.agency_level,
                    payment_status: 'pending'
                });

            if (insertError) {
                logger.error('報酬分配記録の保存エラー:', insertError);
                throw new Error('報酬分配記録の保存に失敗しました');
            }

            logger.log(`✅ 保存完了: ${distribution.agency_name} - ¥${distribution.commission_amount.toLocaleString()}`);
        }

        // STEP 7: 結果を返す
        const result = {
            success: true,
            totalCommission: totalCommission,
            distributions: distributions,
            closingAgency: {
                id: closingAgent.id,
                name: closingAgent.name,
                level: closingAgent.level
            }
        };

        logger.log('=== ✅✅✅ コミッション計算完了 ✅✅✅ ===');
        logger.log('総コミッション額: ¥' + totalCommission.toLocaleString());
        logger.log('分配件数:', distributions.length);

        return result;

    } catch (error) {
        logger.error('=== ❌ コミッション計算エラー ===');
        logger.error('エラーメッセージ:', error.message);
        logger.error('スタックトレース:', error.stack);

        throw error;
    }
}

/**
 * 代理店階層チェーンを取得
 * 指定された代理店から1次代理店までの階層を取得
 *
 * @param {Object} supabase - Supabaseクライアント
 * @param {string} agencyId - 代理店ID (UUID)
 * @returns {Promise<Array>} 代理店階層の配列（下位から上位へ）
 */
async function getAgencyHierarchy(supabase, agencyId) {
    const hierarchy = [];
    let currentAgencyId = agencyId;
    let depth = 0;
    const maxDepth = 10;

    while (currentAgencyId && depth < maxDepth) {
        depth++;

        const { data: agency, error } = await supabase
            .from('agencies')
            .select('id, code, name, level, parent_agency_id, own_commission_rate')
            .eq('id', currentAgencyId)
            .single();

        if (error || !agency) {
            logger.warn('代理店が見つかりません:', currentAgencyId);
            break;
        }

        hierarchy.push(agency);

        // 次の親へ
        currentAgencyId = agency.parent_agency_id;

        // 1次代理店に到達したら終了
        if (agency.level === 1) {
            break;
        }
    }

    return hierarchy;
}

module.exports = {
    getStandardCommissionRate,
    calculateCommissions,
    getAgencyHierarchy
};
