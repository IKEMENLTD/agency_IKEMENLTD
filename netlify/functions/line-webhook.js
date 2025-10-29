const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const crypto = require('crypto');

// Initialize Supabase client with SERVICE_ROLE_KEY
// IMPORTANT: Webhooks are server-side operations that need full database access
// ANON_KEY would be restricted by Row Level Security (RLS)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// LINE Messaging API configuration
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

exports.handler = async (event, context) => {
    // Handle CORS for preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                // Secure CORS - see getCorsHeaders(),
                'Access-Control-Allow-Headers': 'Content-Type, X-Line-Signature',
                'Access-Control-Allow-Methods': 'POST'
            }
        };
    }

    // Only allow POST method
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Verify LINE webhook signature
        const signature = event.headers['x-line-signature'];
        const body = event.body;

        if (!verifySignature(body, signature)) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid signature' })
            };
        }

        const webhookBody = JSON.parse(body);
        const events = webhookBody.events;

        // 無限ループ防止: 既に転送されたリクエストは再転送しない
        const isForwarded = event.headers['x-forwarded-from'];
        if (isForwarded) {
            console.log('⚠️ Request already forwarded from:', isForwarded, '- skipping re-forward to prevent infinite loop');
        }

        // Netlify側の処理（コンバージョン記録のみ）[v2.0]
        for (const event of events) {
            await processLineEvent(event);
        }

        // 外部Webhook URL（Lステップ等）への転送（全イベント）
        // 既に転送されたリクエストは再転送しない（無限ループ防止）
        if (!isForwarded) {
            forwardToExternal(body, signature).catch(err => {
                console.error('Background forward to external webhook failed:', err);
            });
        }

        // メッセージイベントのみRenderに転送（メッセージ処理用）
        // follow/unfollowイベントはNetlify側で完結するため転送不要
        // 既に転送されたリクエストは再転送しない（無限ループ防止）
        const hasMessageEvent = events.some(e => e.type === 'message');
        if (hasMessageEvent && !isForwarded) {
            forwardToRender(body, signature).catch(err => {
                console.error('Background forward to Render failed:', err);
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        console.error('LINE webhook error:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error: ' + error.message
            })
        };
    }
};

// Verify LINE webhook signature
function verifySignature(body, signature) {
    if (!LINE_CHANNEL_SECRET || !signature) {
        return false;
    }

    const hash = crypto
        .createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(body)
        .digest('base64');

    return hash === signature;
}

// Process individual LINE events
async function processLineEvent(event) {
    try {
        switch (event.type) {
            case 'follow':
                await handleFollowEvent(event);
                break;
            case 'unfollow':
                await handleUnfollowEvent(event);
                break;
            case 'message':
                await handleMessageEvent(event);
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }
    } catch (error) {
        console.error('Error processing LINE event:', error);
    }
}

// Handle follow events (user adds bot as friend)
async function handleFollowEvent(event) {
    const userId = event.source.userId;

    try {
        console.log('=== FOLLOW EVENT 受信 ===');
        console.log('LINE User ID:', userId);

        // Get user profile from LINE API
        const userProfile = await getLineUserProfile(userId);

        if (!userProfile) {
            console.error('Failed to get user profile for:', userId);
            return;
        }

        console.log('LINE Profile取得成功:', userProfile.displayName);

        // 🆕 Check if this is an agency registration (代理店登録フロー)
        const { data: agency, error: agencyError } = await supabase
            .from('agencies')
            .select('id, code, name, status, contact_email')
            .eq('line_user_id', userId)
            .single();

        if (!agencyError && agency) {
            console.log('✅ 代理店登録の友達追加を検知:', agency.name);
            console.log('- 代理店ID:', agency.id);
            console.log('- 代理店コード:', agency.code);
            console.log('- 現在のステータス:', agency.status);

            // 代理店が既にアクティブの場合は何もしない（重複防止）
            if (agency.status === 'active') {
                console.log('⚠️ 代理店は既にアクティブ - スキップします');
                return;
            }

            // 代理店をアクティブ化
            const { error: updateError } = await supabase
                .from('agencies')
                .update({
                    status: 'active'
                })
                .eq('id', agency.id);

            if (updateError) {
                console.error('❌ 代理店アクティベーション失敗:', updateError);
            } else {
                console.log('✅ 代理店をアクティブ化しました');

                // ユーザーもアクティブ化
                const { error: userUpdateError } = await supabase
                    .from('agency_users')
                    .update({
                        is_active: true
                    })
                    .eq('agency_id', agency.id)
                    .eq('role', 'owner');

                if (userUpdateError) {
                    console.error('❌ ユーザーアクティベーション失敗:', userUpdateError);
                } else {
                    console.log('✅ ユーザーをアクティブ化しました');
                }

                // 🎉 代理店登録完了メッセージを送信
                await sendAgencyWelcomeMessage(userId, agency);
                console.log('✅ 代理店ウェルカムメッセージ送信完了');
            }

            return; // 代理店フロー完了
        }

        console.log('通常の友達追加として処理します');

        // 🔽 既存のトラッキングユーザー処理（従来通り）

        // Check if user profile already exists
        const { data: existingProfile } = await supabase
            .from('line_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (existingProfile) {
            // Update existing profile
            const { error } = await supabase
                .from('line_profiles')
                .update({
                    display_name: userProfile.displayName,
                    picture_url: userProfile.pictureUrl,
                    status_message: userProfile.statusMessage,
                    language: userProfile.language,
                    fetched_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);

            if (error) {
                console.error('Error updating existing profile:', error);
            }
        } else {
            // Create new profile record
            const profileData = {
                user_id: userId,
                display_name: userProfile.displayName,
                picture_url: userProfile.pictureUrl,
                status_message: userProfile.statusMessage,
                language: userProfile.language,
                fetched_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data: newProfile, error } = await supabase
                .from('line_profiles')
                .insert([profileData])
                .select()
                .single();

            if (error) {
                console.error('Error creating profile:', error);
                return;
            }

            // Try to link with recent tracking visit
            await linkUserToTracking(userId, userId);
        }

        // ⚠️ Netlify側ではメッセージ送信は行わない（Render側のみが送信）
        // await sendWelcomeMessage(userId, userProfile.displayName);

    } catch (error) {
        console.error('Error handling follow event:', error);
    }
}

// Handle unfollow events (user removes bot as friend)
async function handleUnfollowEvent(event) {
    const userId = event.source.userId;

    try {
        // Note: line_profiles table doesn't have is_friend column
        // Just log the unfollow event
        console.log(`User ${userId} unfollowed the bot`);
    } catch (error) {
        console.error('Error handling unfollow event:', error);
    }
}

// Handle message events
async function handleMessageEvent(event) {
    const userId = event.source.userId;

    try {
        // Update user's last activity (using updated_at)
        await supabase
            .from('line_profiles')
            .update({
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);

        // ⚠️ Netlify側ではメッセージ返信は行わない（Render側のみが返信）
        // 代理店プログラムのコンバージョン記録のみを担当
        // if (event.message.type === 'text') {
        //     await handleTextMessage(userId, event.message.text);
        // }
    } catch (error) {
        console.error('Error handling message event:', error);
    }
}

// Get user profile from LINE API
async function getLineUserProfile(userId) {
    try {
        const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });

        if (response.ok) {
            return await response.json();
        } else {
            console.error('Failed to get LINE user profile:', response.status, response.statusText);
            return null;
        }
    } catch (error) {
        console.error('Error getting LINE user profile:', error);
        return null;
    }
}

// Link user to recent tracking visit with enhanced agency attribution
async function linkUserToTracking(lineUserId, userId) {
    try {
        console.log('=== linkUserToTracking 開始 ===');
        console.log('LINE User ID:', lineUserId);

        // 🎯 STEP 1: セッションベースのマッチング（最優先・最高精度）
        const { data: activeSession, error: sessionError } = await supabase
            .from('user_sessions')
            .select('*')
            .is('line_user_id', null)
            .gte('last_activity_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // Within last 2 hours
            .order('last_activity_at', { ascending: false })
            .limit(1);

        if (!sessionError && activeSession && activeSession.length > 0) {
            const session = activeSession[0];
            console.log('✅ セッションマッチング成功:', session.id);

            // Update session with LINE user info
            const { error: updateError } = await supabase
                .from('user_sessions')
                .update({
                    line_user_id: lineUserId,
                    line_friend_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString()
                })
                .eq('id', session.id);

            if (!updateError) {
                console.log(`Linked LINE user ${lineUserId} to session ${session.id} for agency ${session.agency_id}`);

                // Record funnel step
                await supabase
                    .from('conversion_funnels')
                    .insert([{
                        session_id: session.id,
                        agency_id: session.agency_id,
                        step_name: 'line_friend',
                        step_data: {
                            line_user_id: lineUserId,
                            user_id: userId,
                            timestamp: new Date().toISOString()
                        }
                    }]);

                // Create LINE friend conversion if this is an agency session
                if (session.agency_id) {
                    await createAgencyLineConversion(session, lineUserId, userId);
                }

                return session;
            }
        }

        console.log('⚠️ セッションマッチングなし、訪問履歴でマッチング開始');

        // 🎯 STEP 2: 高精度訪問マッチング（IPアドレス + User-Agent + 時間窓）
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10分以内に短縮

        // Get LINE Webhook request info for IP matching
        const lineWebhookIP = getClientIPFromHeaders(event.headers);
        const lineWebhookUserAgent = event.headers['user-agent'] || '';

        console.log('📍 LINE Webhook情報:');
        console.log('- IP:', lineWebhookIP);
        console.log('- User-Agent:', lineWebhookUserAgent.substring(0, 100));

        // Try agency_tracking_visits with stricter matching
        const { data: candidateVisits, error: agencyError } = await supabase
            .from('agency_tracking_visits')
            .select('*')
            .is('line_user_id', null)
            .gte('created_at', tenMinutesAgo) // 10分以内
            .order('created_at', { ascending: false });

        if (agencyError) {
            console.error('❌ 訪問履歴取得エラー:', agencyError);
            return null;
        }

        if (!candidateVisits || candidateVisits.length === 0) {
            console.log('⚠️ 過去10分以内の未紐付け訪問なし');
            return null;
        }

        console.log(`📊 候補訪問数: ${candidateVisits.length}件`);

        // 🔍 STEP 3: スコアリングによる最適マッチング
        let bestMatch = null;
        let bestScore = 0;

        for (const visit of candidateVisits) {
            let score = 0;
            const debugInfo = { visit_id: visit.id, scores: {} };

            // 🔥 IPアドレス完全一致（最高優先度）+10点
            if (visit.visitor_ip && lineWebhookIP && lineWebhookIP !== 'unknown') {
                if (visit.visitor_ip === lineWebhookIP) {
                    score += 10;
                    debugInfo.scores.ip_match = 10;
                    debugInfo.ip_matched = true;
                } else {
                    // IP不一致は減点（異なるネットワークからのアクセス）
                    debugInfo.ip_matched = false;
                    debugInfo.visitor_ip = visit.visitor_ip;
                    debugInfo.webhook_ip = lineWebhookIP;
                }
            }

            // 🔥 User-Agent完全一致 +10点
            if (visit.user_agent && lineWebhookUserAgent) {
                // User-Agentの類似度を計算（完全一致または部分一致）
                const visitUA = visit.user_agent.toLowerCase();
                const webhookUA = lineWebhookUserAgent.toLowerCase();

                if (visitUA === webhookUA) {
                    // 完全一致
                    score += 10;
                    debugInfo.scores.ua_exact_match = 10;
                } else if (visitUA.includes('line') && webhookUA.includes('line')) {
                    // LINEアプリ内ブラウザ同士（部分一致）
                    score += 7;
                    debugInfo.scores.ua_line_match = 7;
                } else {
                    // ブラウザ種類が一致するか確認
                    const visitBrowser = extractBrowser(visitUA);
                    const webhookBrowser = extractBrowser(webhookUA);

                    if (visitBrowser === webhookBrowser && visitBrowser !== 'unknown') {
                        score += 3;
                        debugInfo.scores.ua_browser_match = 3;
                        debugInfo.browser = visitBrowser;
                    } else {
                        debugInfo.ua_mismatch = true;
                        debugInfo.visit_browser = visitBrowser;
                        debugInfo.webhook_browser = webhookBrowser;
                    }
                }
            }

            // 時間的近さスコア（最近ほど高い）
            const ageMinutes = (Date.now() - new Date(visit.created_at).getTime()) / (60 * 1000);
            const timeScore = Math.max(0, 10 - ageMinutes); // 0分=10点、10分=0点
            score += timeScore;
            debugInfo.scores.time = timeScore.toFixed(2);

            // セッションIDがある場合は大幅加点
            if (visit.session_id) {
                score += 20;
                debugInfo.scores.session = 20;
            }

            // Referrer検証: 公式サイトからの流入を除外
            if (visit.referrer) {
                const isOfficialSite =
                    visit.referrer.includes('taskmateai.net') ||
                    visit.referrer.includes('agency.ikemen.ltd') ||
                    visit.referrer.includes('ikemen.ltd');

                if (isOfficialSite && !visit.tracking_link_id) {
                    // 公式サイトからの流入でトラッキングリンク経由でない場合は大幅減点
                    score -= 50;
                    debugInfo.scores.official_penalty = -50;
                    debugInfo.referrer = visit.referrer;
                }
            }

            // トラッキングリンク経由（代理店リンク）は加点
            if (visit.tracking_link_id) {
                score += 15;
                debugInfo.scores.tracking_link = 15;
            }

            // デバイス情報の一貫性（同じブラウザ/OS）
            if (visit.browser) {
                score += 5;
                debugInfo.scores.browser = 5;
            }

            debugInfo.total_score = score;
            console.log('📊 訪問スコア:', JSON.stringify(debugInfo));

            if (score > bestScore) {
                bestScore = score;
                bestMatch = visit;
            }
        }

        // 🎯 STEP 4: ベストマッチのみ紐付け
        if (bestMatch && bestScore > 0) {
            console.log(`✅ ベストマッチ決定: visit_id=${bestMatch.id}, score=${bestScore}`);
            console.log(`- Tracking Link ID: ${bestMatch.tracking_link_id || 'なし'}`);
            console.log(`- Agency ID: ${bestMatch.agency_id || 'なし'}`);
            console.log(`- Referrer: ${bestMatch.referrer || 'なし'}`);

            const { error: updateError } = await supabase
                .from('agency_tracking_visits')
                .update({ line_user_id: lineUserId })
                .eq('id', bestMatch.id);

            if (!updateError) {
                console.log(`✅ LINE user ${lineUserId} を visit ${bestMatch.id} に紐付けました`);

                // コンバージョン記録（代理店リンク経由の場合のみ）
                if (bestMatch.tracking_link_id && bestMatch.agency_id) {
                    await createAgencyConversion(bestMatch, lineUserId);
                }

                return bestMatch;
            } else {
                console.error('❌ 訪問更新エラー:', updateError);
            }
        } else {
            console.log('⚠️ 有効なマッチングなし（スコアが低い、または候補なし）');
        }

        // 🔽 STEP 5: 旧tracking_visitsテーブルのフォールバック（互換性維持）
        const { data: recentVisits, error } = await supabase
            .from('tracking_visits')
            .select('*')
            .is('line_user_id', null)
            .gte('visited_at', tenMinutesAgo)
            .order('visited_at', { ascending: false })
            .limit(1);

        if (!error && recentVisits && recentVisits.length > 0) {
            const { error: updateError } = await supabase
                .from('tracking_visits')
                .update({ line_user_id: userId })
                .eq('id', recentVisits[0].id);

            if (!updateError) {
                console.log(`✅ (旧テーブル) LINE user ${lineUserId} を visit ${recentVisits[0].id} に紐付けました`);
                return recentVisits[0];
            }
        }

        console.log('⚠️ 紐付け可能な訪問が見つかりませんでした');
        return null;
    } catch (error) {
        console.error('Error linking user to tracking:', error);
        return null;
    }
}

// Create agency conversion from visit (used in linkUserToTracking)
async function createAgencyConversion(visit, lineUserId) {
    try {
        console.log('=== createAgencyConversion 開始 ===');
        console.log('Visit ID:', visit.id);
        console.log('Agency ID:', visit.agency_id);
        console.log('Tracking Link ID:', visit.tracking_link_id);

        // Check if conversion already exists
        const { data: existingConversion } = await supabase
            .from('agency_conversions')
            .select('id')
            .eq('tracking_link_id', visit.tracking_link_id)
            .eq('line_user_id', lineUserId)
            .eq('conversion_type', 'line_friend')
            .single();

        if (existingConversion) {
            console.log('⚠️ コンバージョンは既に記録済み');
            return; // Already recorded
        }

        // Get tracking link to extract service_id
        let serviceId = null;
        if (visit.tracking_link_id) {
            const { data: trackingLink } = await supabase
                .from('agency_tracking_links')
                .select('service_id')
                .eq('id', visit.tracking_link_id)
                .single();

            serviceId = trackingLink?.service_id || null;
        }

        const conversionData = {
            agency_id: visit.agency_id,
            tracking_link_id: visit.tracking_link_id,
            visit_id: visit.id,
            service_id: serviceId,
            line_user_id: lineUserId,
            conversion_type: 'line_friend',
            conversion_value: 0,
            line_display_name: null, // Will be updated when profile is fetched
            metadata: {
                referrer: visit.referrer,
                utm_source: visit.utm_source,
                utm_medium: visit.utm_medium,
                utm_campaign: visit.utm_campaign,
                device_type: visit.device_type,
                browser: visit.browser,
                os: visit.os
            }
        };

        const { error: conversionError } = await supabase
            .from('agency_conversions')
            .insert([conversionData]);

        if (conversionError) {
            console.error('❌ コンバージョン記録エラー:', conversionError);
        } else {
            console.log(`✅ LINE友達追加コンバージョンを記録 (Agency: ${visit.agency_id})`);

            // Update tracking link conversion count
            if (visit.tracking_link_id) {
                await supabase.rpc('increment_tracking_link_conversions', {
                    link_id: visit.tracking_link_id
                }).catch(err => {
                    // Fallback to direct update if RPC doesn't exist
                    supabase
                        .from('agency_tracking_links')
                        .update({
                            conversion_count: supabase.raw('conversion_count + 1')
                        })
                        .eq('id', visit.tracking_link_id);
                });
            }
        }

    } catch (error) {
        console.error('❌ createAgencyConversion エラー:', error);
    }
}

// Create agency LINE friend conversion
async function createAgencyLineConversion(session, lineUserId, userId) {
    try {
        // Check if conversion already exists
        const { data: existingConversion } = await supabase
            .from('agency_conversions')
            .select('id')
            .eq('session_id', session.id)
            .eq('conversion_type', 'line_friend')
            .single();

        if (existingConversion) {
            return; // Already recorded
        }

        // Get tracking link to extract service_id (multi-service support)
        let serviceId = null;
        if (session.tracking_link_id) {
            const { data: trackingLink } = await supabase
                .from('agency_tracking_links')
                .select('service_id')
                .eq('id', session.tracking_link_id)
                .single();

            serviceId = trackingLink?.service_id || null;
        }

        // Get agency information for commission calculation
        const { data: agency } = await supabase
            .from('agencies')
            .select('commission_rate')
            .eq('id', session.agency_id)
            .single();

        const conversionData = {
            agency_id: session.agency_id,
            tracking_link_id: session.tracking_link_id,
            visit_id: session.visit_id,
            session_id: session.id,
            service_id: serviceId,  // Multi-service support
            user_id: userId,
            line_user_id: lineUserId,
            conversion_type: 'line_friend',
            conversion_value: 0, // LINE friend has no direct monetary value
            metadata: {
                session_metadata: session.metadata,
                utm_source: session.utm_source,
                utm_medium: session.utm_medium,
                utm_campaign: session.utm_campaign
            }
        };

        const { error: conversionError } = await supabase
            .from('agency_conversions')
            .insert([conversionData]);

        if (conversionError) {
            console.error('Error creating agency LINE conversion:', conversionError);
        } else {
            console.log(`LINE friend conversion recorded for agency ${session.agency_id}`);

            // Update tracking link conversion count
            if (session.tracking_link_id) {
                await supabase
                    .from('agency_tracking_links')
                    .update({
                        conversion_count: supabase.raw('conversion_count + 1')
                    })
                    .eq('id', session.tracking_link_id);
            }

            // Send notification to agency (future enhancement)
            await notifyAgencyOfConversion(session.agency_id, 'line_friend', conversionData);
        }

    } catch (error) {
        console.error('Error creating agency LINE conversion:', error);
    }
}

// Notify agency of new conversion (placeholder for future implementation)
async function notifyAgencyOfConversion(agencyId, conversionType, conversionData) {
    try {
        // This could send email notifications, webhook calls, etc.
        console.log(`Notification: Agency ${agencyId} has new ${conversionType} conversion`);

        // For now, just log the event
        // Future implementation could include:
        // - Email notifications
        // - Slack/Discord webhooks
        // - Real-time dashboard updates
        // - SMS notifications for high-value conversions

    } catch (error) {
        console.error('Error sending agency notification:', error);
    }
}

// Send welcome message to new user
// ⚠️ Disabled for multi-service system (each service handles its own messages)
async function sendWelcomeMessage(userId, displayName) {
    console.log('⚠️ sendWelcomeMessage called but disabled (multi-service system)');
    return;

    try {
        const message = {
            type: 'text',
            text: `こんにちは${displayName}さん！\n\nご登録いただき、ありがとうございます。\n\n何かご質問がございましたら、お気軽にメッセージをお送りください。\n\nよろしくお願いいたします！`
        };

        await sendLineMessage(userId, message);
    } catch (error) {
        console.error('Error sending welcome message:', error);
    }
}

// Handle text messages
async function handleTextMessage(userId, text) {
    // ⚠️ Netlify側ではメッセージ返信を完全に無効化（Render側のみが返信）
    console.log('⚠️ handleTextMessage called but disabled (Netlify side)');
    return;

    try {
        // Simple auto-response logic
        let response = '';

        if (text.includes('こんにちは') || text.includes('こんばんは')) {
            response = 'こんにちは！どのようなことでお手伝いできますか？';
        } else if (text.includes('ありがとう')) {
            response = 'どういたしまして！他にもご質問がございましたら、お気軽にお聞かせください。';
        } else if (text.includes('機能') || text.includes('できること')) {
            response = 'サービスの詳細については、代理店にお問い合わせください。';
        } else {
            response = 'メッセージをありがとうございます！\n\n詳しくは代理店にお問い合わせください。';
        }

        if (response) {
            await sendLineMessage(userId, {
                type: 'text',
                text: response
            });
        }
    } catch (error) {
        console.error('Error handling text message:', error);
    }
}

// Send message via LINE Messaging API
async function sendLineMessage(userId, message) {
    // ⚠️ Netlify側ではメッセージ送信を完全に無効化（Render側のみが送信）
    console.log('⚠️ sendLineMessage called but disabled (Netlify side)');
    return;

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: userId,
                messages: [message]
            })
        });

        if (!response.ok) {
            console.error('Failed to send LINE message:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error sending LINE message:', error);
    }
}

// 🆕 Send agency registration welcome message
async function sendAgencyWelcomeMessage(userId, agency) {
    // ⚠️ Netlify側ではメッセージ送信を完全に無効化（Render側のみが送信）
    console.log('⚠️ sendAgencyWelcomeMessage called but disabled (Netlify side)');
    return;

    try {
        console.log('代理店ウェルカムメッセージ送信開始:', agency.name);

        const welcomeMessage = {
            type: 'flex',
            altText: '✅ LINE連携が完了しました！',
            contents: {
                type: 'bubble',
                hero: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: '✅',
                            size: '4xl',
                            align: 'center',
                            weight: 'bold',
                            color: '#10b981'
                        }
                    ],
                    backgroundColor: '#f0fdf4',
                    paddingAll: '20px'
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: 'LINE連携完了',
                            weight: 'bold',
                            size: 'xl',
                            color: '#1f2937'
                        },
                        {
                            type: 'text',
                            text: '株式会社イケメン パートナー登録',
                            size: 'sm',
                            color: '#6b7280',
                            margin: 'md'
                        },
                        {
                            type: 'separator',
                            margin: 'xl'
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'lg',
                            spacing: 'sm',
                            contents: [
                                {
                                    type: 'box',
                                    layout: 'baseline',
                                    spacing: 'sm',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: '代理店名',
                                            color: '#6b7280',
                                            size: 'sm',
                                            flex: 2
                                        },
                                        {
                                            type: 'text',
                                            text: agency.name,
                                            wrap: true,
                                            color: '#111827',
                                            size: 'sm',
                                            flex: 5,
                                            weight: 'bold'
                                        }
                                    ]
                                },
                                {
                                    type: 'box',
                                    layout: 'baseline',
                                    spacing: 'sm',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: '代理店コード',
                                            color: '#6b7280',
                                            size: 'sm',
                                            flex: 2
                                        },
                                        {
                                            type: 'text',
                                            text: agency.code,
                                            wrap: true,
                                            color: '#10b981',
                                            size: 'md',
                                            flex: 5,
                                            weight: 'bold'
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            type: 'separator',
                            margin: 'xl'
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'lg',
                            spacing: 'sm',
                            contents: [
                                {
                                    type: 'text',
                                    text: '🎉 次のステップ',
                                    weight: 'bold',
                                    color: '#111827',
                                    margin: 'md'
                                },
                                {
                                    type: 'text',
                                    text: '1. ダッシュボードにログイン\n2. トラッキングリンクを作成\n3. お客様に共有して報酬GET!',
                                    wrap: true,
                                    color: '#4b5563',
                                    size: 'sm',
                                    margin: 'md'
                                }
                            ]
                        }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            height: 'sm',
                            action: {
                                type: 'uri',
                                label: 'ダッシュボードへ',
                                uri: 'https://agency.ikemen.ltd/'
                            },
                            color: '#10b981'
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            contents: [],
                            margin: 'sm'
                        }
                    ],
                    flex: 0
                }
            }
        };

        await sendLineMessage(userId, welcomeMessage);
        console.log('✅ 代理店ウェルカムメッセージ送信成功');

    } catch (error) {
        console.error('❌ 代理店ウェルカムメッセージ送信失敗:', error);
    }
}

// Validate environment variables on cold start
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
}

// Forward LINE webhook to Render (TaskMate AI)
async function forwardToRender(body, signature) {
    const renderWebhookUrl = process.env.RENDER_WEBHOOK_URL || 'https://gasgenerator.onrender.com/api/webhook';

    if (!renderWebhookUrl) {
        console.log('⚠️ RENDER_WEBHOOK_URL not configured, skipping forward to Render');
        return;
    }

    try {
        console.log('📤 [v2.0] Forwarding to Render TaskMate AI:', renderWebhookUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for Render wake-up

        const response = await fetch(renderWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Line-Signature': signature,
                'X-Forwarded-From': 'netlify'  // 無限ループ防止フラグ
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('⚠️ Render forward failed with status:', response.status);
        } else {
            console.log('✅ Render forward successful');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('⏱️ Render forward timeout (30s) - Render may be sleeping');
        } else {
            console.error('❌ Render forward error:', error.message);
        }
    }
}

// Forward LINE webhook to External Service (Lステップ等)
async function forwardToExternal(body, signature) {
    const externalWebhookUrl = process.env.EXTERNAL_WEBHOOK_URL;

    if (!externalWebhookUrl) {
        console.log('⚠️ EXTERNAL_WEBHOOK_URL not configured, skipping forward to external service');
        return;
    }

    try {
        console.log('📤 Forwarding to External Webhook:', externalWebhookUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(externalWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Line-Signature': signature
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('⚠️ External webhook forward failed with status:', response.status);
        } else {
            console.log('✅ External webhook forward successful');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('⏱️ External webhook forward timeout (10s)');
        } else {
            console.error('❌ External webhook forward error:', error.message);
        }
    }
}

// Helper function: Extract browser type from User-Agent string
function extractBrowser(userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('chrome/') && !ua.includes('edg/')) return 'chrome';
    if (ua.includes('firefox/')) return 'firefox';
    if (ua.includes('safari/') && !ua.includes('chrome/')) return 'safari';
    if (ua.includes('line/')) return 'line';
    if (ua.includes('opera/') || ua.includes('opr/')) return 'opera';
    return 'unknown';
}

// Helper function: Get client IP address from request headers
function getClientIPFromHeaders(headers) {
    // Check common proxy headers in priority order
    const ipHeaders = [
        'x-forwarded-for',      // Most common (Netlify, Cloudflare, etc.)
        'x-real-ip',            // Nginx proxy
        'x-client-ip',          // Apache proxy
        'cf-connecting-ip',     // Cloudflare specific
        'x-forwarded',          // Alternative
        'forwarded-for',        // Alternative
        'forwarded'             // RFC 7239
    ];

    for (const header of ipHeaders) {
        const value = headers[header];
        if (value) {
            // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2)
            // Take the first one (actual client IP)
            return value.split(',')[0].trim();
        }
    }

    return 'unknown';
}

if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('Missing LINE environment variables: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN');
}