const { createClient } = require('@supabase/supabase-js');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const crypto = require('crypto');
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');

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
        // First, try to find an active session for this user
        const { data: activeSession, error: sessionError } = await supabase
            .from('user_sessions')
            .select('*')
            .is('line_user_id', null)
            .gte('last_activity_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // Within last 2 hours
            .order('last_activity_at', { ascending: false })
            .limit(1);

        if (!sessionError && activeSession && activeSession.length > 0) {
            const session = activeSession[0];

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

        // Fallback to old method for backward compatibility
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // Try agency_tracking_visits first
        const { data: agencyVisits, error: agencyError } = await supabase
            .from('agency_tracking_visits')
            .select('*')
            .is('line_user_id', null)
            .gte('created_at', oneHourAgo)
            .order('created_at', { ascending: false })
            .limit(5);

        if (!agencyError && agencyVisits && agencyVisits.length > 0) {
            // Link all recent visits to this user (not just the first one)
            const { error: updateError } = await supabase
                .from('agency_tracking_visits')
                .update({ line_user_id: lineUserId })
                .in('id', agencyVisits.map(v => v.id));

            if (!updateError) {
                console.log(`Linked LINE user ${lineUserId} to ${agencyVisits.length} agency visit(s)`);
            }
        }

        // Also check old tracking_visits table
        const { data: recentVisits, error } = await supabase
            .from('tracking_visits')
            .select('*')
            .is('line_user_id', null)
            .gte('visited_at', oneHourAgo)
            .order('visited_at', { ascending: false })
            .limit(5);

        if (error || !recentVisits || recentVisits.length === 0) {
            return null;
        }

        // Link the most recent visit to this user
        const { error: updateError } = await supabase
            .from('tracking_visits')
            .update({ line_user_id: userId })
            .eq('id', recentVisits[0].id);

        if (!updateError) {
            console.log(`Linked LINE user ${lineUserId} to visit ${recentVisits[0].id}`);
        }

        return null;
    } catch (error) {
        console.error('Error linking user to tracking:', error);
        return null;
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

if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('Missing LINE environment variables: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN');
}