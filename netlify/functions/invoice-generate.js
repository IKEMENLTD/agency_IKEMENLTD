const jwt = require('jsonwebtoken');
const { getCorsHeaders } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const sgMail = require('@sendgrid/mail');
const path = require('path');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // JWT認証
    const authHeader = event.headers.authorization;
    const agencyId = event.headers['x-agency-id'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: '認証が必要です' })
        };
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!agencyId || decoded.agencyId !== agencyId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'アクセス権限がありません' })
            };
        }

        // リクエストボディ解析
        const body = JSON.parse(event.body || '{}');
        const { period_start, period_end } = body;

        if (!period_start || !period_end) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: '期間の指定が必要です' })
            };
        }

        // 代理店情報取得
        const { data: agency, error: agencyError } = await supabase
            .from('agencies')
            .select('*')
            .eq('id', agencyId)
            .single();

        if (agencyError || !agency) {
            throw new Error('代理店情報の取得に失敗しました');
        }

        // コミッション情報取得（期間が完全一致するもの）
        const { data: commissions, error: commissionsError } = await supabase
            .from('agency_commissions')
            .select(`
                *,
                services (
                    id,
                    name,
                    monthly_fee
                )
            `)
            .eq('agency_id', agencyId)
            .eq('period_start', period_start)
            .eq('period_end', period_end)
            .eq('status', 'approved');

        if (commissionsError) {
            throw commissionsError;
        }

        if (!commissions || commissions.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: '指定期間に承認済みのコミッションが見つかりません'
                })
            };
        }

        // 小計計算
        const subtotal = commissions.reduce((sum, c) =>
            sum + parseFloat(c.commission_amount || 0), 0
        );

        // 消費税計算（切り捨て）
        const taxRate = 10.00;
        const taxAmount = Math.floor(subtotal * (taxRate / 100));

        // 源泉徴収税計算（個人事業主のみ）
        let withholdingTaxRate = 0;
        let withholdingTaxAmount = 0;

        if (agency.entity_type === 'individual') {
            const totalBeforeWithholding = subtotal + taxAmount;

            if (totalBeforeWithholding <= 1000000) {
                withholdingTaxRate = 10.21;
                withholdingTaxAmount = Math.floor(totalBeforeWithholding * 0.1021);
            } else {
                withholdingTaxRate = 10.21; // 表示用（実際は段階的）
                withholdingTaxAmount = Math.floor(1000000 * 0.1021) +
                                      Math.floor((totalBeforeWithholding - 1000000) * 0.2042);
            }
        }

        // 合計金額
        const totalAmount = subtotal + taxAmount - withholdingTaxAmount;

        // 請求書番号生成
        const invoiceDate = new Date();
        const yearMonth = invoiceDate.getFullYear().toString() +
                         (invoiceDate.getMonth() + 1).toString().padStart(2, '0');

        const { data: invoiceNumberData, error: invoiceNumberError } = await supabase
            .rpc('get_next_invoice_number', { target_year_month: yearMonth });

        if (invoiceNumberError) {
            throw new Error('請求書番号の生成に失敗しました: ' + invoiceNumberError.message);
        }

        const invoiceNumber = invoiceNumberData;

        // 支払期日（請求日の翌月末）
        const paymentDueDate = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 2, 0);

        // 請求書レコード作成
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
                invoice_number: invoiceNumber,
                invoice_date: invoiceDate.toISOString().split('T')[0],
                payment_due_date: paymentDueDate.toISOString().split('T')[0],
                agency_id: agencyId,
                agency_name: agency.name,
                agency_code: agency.code,
                agency_entity_type: agency.entity_type || 'corporation',
                agency_invoice_registration_number: agency.invoice_registration_number,
                agency_address: agency.address,
                agency_contact_email: agency.contact_email,
                agency_contact_phone: agency.contact_phone,
                agency_payment_info: agency.payment_info || {},
                period_start,
                period_end,
                subtotal,
                tax_rate: taxRate,
                tax_amount: taxAmount,
                withholding_tax_rate: withholdingTaxRate,
                withholding_tax_amount: withholdingTaxAmount,
                total_amount: totalAmount,
                is_qualified_invoice: agency.is_qualified_invoice_issuer || false,
                status: 'draft'
            })
            .select()
            .single();

        if (invoiceError) {
            throw new Error('請求書の作成に失敗しました: ' + invoiceError.message);
        }

        // 請求明細レコード作成
        const invoiceItems = commissions.map((commission, index) => ({
            invoice_id: invoice.id,
            service_id: commission.service_id,
            service_name: commission.services?.name || 'サービス',
            commission_id: commission.id,
            description: `${commission.services?.name || 'サービス'} コミッション`,
            quantity: 1,
            conversion_count: commission.total_conversions,
            total_sales: parseFloat(commission.total_sales || 0),
            commission_rate: parseFloat(commission.commission_rate || 0),
            unit_price: parseFloat(commission.commission_amount || 0),
            amount: parseFloat(commission.commission_amount || 0),
            sort_order: index
        }));

        const { error: itemsError } = await supabase
            .from('invoice_items')
            .insert(invoiceItems);

        if (itemsError) {
            throw new Error('請求明細の作成に失敗しました: ' + itemsError.message);
        }

        // コミッションに請求書IDを紐付け
        const commissionIds = commissions.map(c => c.id);
        await supabase
            .from('agency_commissions')
            .update({ invoice_id: invoice.id })
            .in('id', commissionIds);

        // PDF生成
        const pdfBuffer = await generateInvoicePDF(invoice, invoiceItems, agency);

        // PDFをBase64エンコード
        const pdfBase64 = pdfBuffer.toString('base64');

        // メール送信
        const emailResult = await sendInvoiceEmail(
            agency.contact_email,
            agency.name,
            invoiceNumber,
            pdfBase64
        );

        // 請求書ステータス更新
        const { error: updateError } = await supabase
            .from('invoices')
            .update({
                status: 'issued',
                pdf_generated_at: new Date().toISOString(),
                email_sent_at: emailResult.success ? new Date().toISOString() : null,
                email_recipient: agency.contact_email,
                email_status: emailResult.success ? 'sent' : 'failed',
                email_error: emailResult.error || null
            })
            .eq('id', invoice.id);

        if (updateError) {
            console.error('請求書ステータス更新エラー:', updateError);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                invoice: {
                    id: invoice.id,
                    invoice_number: invoiceNumber,
                    invoice_date: invoice.invoice_date,
                    payment_due_date: invoice.payment_due_date,
                    subtotal,
                    tax_amount: taxAmount,
                    withholding_tax_amount: withholdingTaxAmount,
                    total_amount: totalAmount,
                    status: 'issued'
                },
                email: emailResult
            })
        };

    } catch (error) {
        console.error('請求書生成エラー:', error);

        if (error.name === 'JsonWebTokenError') {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: '無効な認証トークンです' })
            };
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: '請求書の生成に失敗しました',
                details: error.message
            })
        };
    }
};

// PDF生成関数
async function generateInvoicePDF(invoice, items, agency) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // フォント設定
            const fontPath = path.join(__dirname, 'fonts', 'ipag.ttf');
            if (fs.existsSync(fontPath)) {
                doc.registerFont('IPAGothic', fontPath);
                doc.font('IPAGothic');
            }

            // ヘッダー
            doc.fontSize(24).text('支払明細書', { align: 'center' });
            doc.moveDown();

            // 明細書番号・日付
            doc.fontSize(10);
            doc.text(`明細書番号: ${invoice.invoice_number}`, { align: 'right' });
            doc.text(`発行日: ${formatDate(invoice.invoice_date)}`, { align: 'right' });
            doc.text(`お支払期限: ${formatDate(invoice.payment_due_date)}`, { align: 'right' });
            doc.moveDown(2);

            // 宛先
            doc.fontSize(12).text(`${invoice.agency_name} 御中`, { align: 'left' });
            doc.moveDown();

            // 発行元情報（株式会社イケメン）
            doc.fontSize(10);
            doc.text('発行元:', { continued: false });
            doc.text('株式会社イケメン');
            doc.text('〒XXX-XXXX 東京都XXX区XXX');
            doc.text('電話: 03-XXXX-XXXX');
            doc.text('Email: info@agency.ikemen.ltd');

            if (invoice.is_qualified_invoice && invoice.agency_invoice_registration_number) {
                doc.text(`登録番号: ${invoice.agency_invoice_registration_number}`);
            }
            doc.moveDown(2);

            // 請求内容テーブル
            const tableTop = doc.y;
            const col1 = 50;
            const col2 = 200;
            const col3 = 300;
            const col4 = 400;
            const col5 = 480;

            // テーブルヘッダー
            doc.fontSize(9);
            doc.text('サービス名', col1, tableTop);
            doc.text('CV数', col2, tableTop);
            doc.text('売上', col3, tableTop);
            doc.text('料率', col4, tableTop);
            doc.text('金額', col5, tableTop);

            doc.moveTo(col1, tableTop + 15).lineTo(545, tableTop + 15).stroke();

            // テーブル行
            let yPosition = tableTop + 20;
            items.forEach(item => {
                if (yPosition > 700) {
                    doc.addPage();
                    yPosition = 50;
                }

                doc.text(item.service_name, col1, yPosition, { width: 140 });
                doc.text(item.conversion_count?.toString() || '-', col2, yPosition);
                doc.text(`¥${formatNumber(item.total_sales)}`, col3, yPosition);
                doc.text(`${item.commission_rate}%`, col4, yPosition);
                doc.text(`¥${formatNumber(item.amount)}`, col5, yPosition, { align: 'right' });

                yPosition += 20;
            });

            doc.moveTo(col1, yPosition).lineTo(545, yPosition).stroke();
            yPosition += 10;

            // 合計セクション
            doc.fontSize(10);
            doc.text('小計:', 400, yPosition);
            doc.text(`¥${formatNumber(invoice.subtotal)}`, 480, yPosition, { align: 'right' });
            yPosition += 20;

            doc.text(`消費税 (${invoice.tax_rate}%):`, 400, yPosition);
            doc.text(`¥${formatNumber(invoice.tax_amount)}`, 480, yPosition, { align: 'right' });
            yPosition += 20;

            if (invoice.withholding_tax_amount > 0) {
                doc.text(`源泉徴収税 (${invoice.withholding_tax_rate}%):`, 400, yPosition);
                doc.text(`-¥${formatNumber(invoice.withholding_tax_amount)}`, 480, yPosition, { align: 'right' });
                yPosition += 20;
            }

            doc.moveTo(400, yPosition).lineTo(545, yPosition).stroke();
            yPosition += 10;

            doc.fontSize(12).text('合計金額:', 400, yPosition);
            doc.text(`¥${formatNumber(invoice.total_amount)}`, 480, yPosition, { align: 'right' });

            // フッター
            doc.fontSize(8);
            doc.text(
                '※ 本支払明細書は電子帳簿保存法に基づき7年間保存されます。',
                50,
                750,
                { align: 'center' }
            );

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// メール送信関数
async function sendInvoiceEmail(recipientEmail, agencyName, invoiceNumber, pdfBase64) {
    try {
        const msg = {
            to: recipientEmail,
            from: {
                email: process.env.SENDGRID_FROM_EMAIL || 'info@agency.ikemen.ltd',
                name: '株式会社イケメン'
            },
            subject: `【株式会社イケメン】支払明細書発行のお知らせ（${invoiceNumber}）`,
            text: `
${agencyName} 様

いつもお世話になっております。
株式会社イケメンです。

${invoiceNumber} の支払明細書を発行いたしましたので、添付のPDFファイルをご確認ください。

お支払期限までにお振込みをお願いいたします。

ご不明な点がございましたら、お気軽にお問い合わせください。

────────────────
株式会社イケメン
Email: info@agency.ikemen.ltd
────────────────
            `,
            attachments: [
                {
                    content: pdfBase64,
                    filename: `payment_statement_${invoiceNumber}.pdf`,
                    type: 'application/pdf',
                    disposition: 'attachment'
                }
            ]
        };

        await sgMail.send(msg);

        return { success: true };
    } catch (error) {
        console.error('メール送信エラー:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 日付フォーマット
function formatDate(dateString) {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// 数値フォーマット（カンマ区切り）
function formatNumber(num) {
    return parseFloat(num || 0).toLocaleString('ja-JP');
}
