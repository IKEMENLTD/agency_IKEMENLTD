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
        const { invoice_id, recipient_email } = body;

        if (!invoice_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: '請求書IDが必要です' })
            };
        }

        // 請求書情報取得
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', invoice_id)
            .eq('agency_id', agencyId)
            .single();

        if (invoiceError || !invoice) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: '請求書が見つかりません' })
            };
        }

        // 請求明細取得
        const { data: items, error: itemsError } = await supabase
            .from('invoice_items')
            .select('*')
            .eq('invoice_id', invoice_id)
            .order('sort_order', { ascending: true });

        if (itemsError) {
            throw itemsError;
        }

        // PDF生成
        const pdfBuffer = await generateInvoicePDF(invoice, items || []);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 送信先メールアドレス（指定があればそれを使用、なければ元のメールアドレス）
        const emailTo = recipient_email || invoice.agency_contact_email;

        if (!emailTo) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'メールアドレスが指定されていません' })
            };
        }

        // メール送信
        const emailResult = await sendInvoiceEmail(
            emailTo,
            invoice.agency_name,
            invoice.invoice_number,
            pdfBase64
        );

        // 請求書のメール送信情報を更新
        if (emailResult.success) {
            await supabase
                .from('invoices')
                .update({
                    email_sent_at: new Date().toISOString(),
                    email_recipient: emailTo,
                    email_status: 'sent',
                    email_error: null,
                    status: invoice.status === 'issued' ? 'sent' : invoice.status
                })
                .eq('id', invoice_id);
        } else {
            await supabase
                .from('invoices')
                .update({
                    email_status: 'failed',
                    email_error: emailResult.error
                })
                .eq('id', invoice_id);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: emailResult.success,
                message: emailResult.success ?
                    'メールを再送信しました' :
                    'メール送信に失敗しました',
                error: emailResult.error
            })
        };

    } catch (error) {
        console.error('メール再送信エラー:', error);

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
                error: 'メール再送信に失敗しました',
                details: error.message
            })
        };
    }
};

// PDF生成関数
async function generateInvoicePDF(invoice, items) {
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
            doc.fontSize(24).text('請求書', { align: 'center' });
            doc.moveDown();

            // 請求書番号・日付
            doc.fontSize(10);
            doc.text(`請求書番号: ${invoice.invoice_number}`, { align: 'right' });
            doc.text(`発行日: ${formatDate(invoice.invoice_date)}`, { align: 'right' });
            doc.text(`お支払期限: ${formatDate(invoice.payment_due_date)}`, { align: 'right' });
            doc.moveDown(2);

            // 宛先
            doc.fontSize(12).text(`${invoice.agency_name} 御中`, { align: 'left' });
            doc.moveDown();

            // 発行元情報
            doc.fontSize(10);
            doc.text('発行元:', { continued: false });
            doc.text('TaskMate AI');
            doc.text('〒XXX-XXXX 東京都XXX区XXX');
            doc.text('電話: 03-XXXX-XXXX');
            doc.text('Email: billing@taskmateai.net');

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
                '※ 本請求書は電子帳簿保存法に基づき7年間保存されます。',
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
                email: process.env.SENDGRID_FROM_EMAIL || 'noreply@taskmateai.net',
                name: 'TaskMate AI 経理部'
            },
            subject: `【TaskMate AI】請求書発行のお知らせ（${invoiceNumber}）`,
            text: `
${agencyName} 様

いつもお世話になっております。
TaskMate AI 経理部です。

${invoiceNumber} の請求書を発行いたしましたので、添付のPDFファイルをご確認ください。

お支払期限までにお振込みをお願いいたします。

ご不明な点がございましたら、お気軽にお問い合わせください。

────────────────
TaskMate AI 経理部
Email: billing@taskmateai.net
────────────────
            `,
            attachments: [
                {
                    content: pdfBase64,
                    filename: `invoice_${invoiceNumber}.pdf`,
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

function formatDate(dateString) {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatNumber(num) {
    return parseFloat(num || 0).toLocaleString('ja-JP');
}
