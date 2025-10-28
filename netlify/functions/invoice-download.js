const jwt = require('jsonwebtoken');
const { getCorsHeaders } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agency-Id',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
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

        // 請求書ID取得
        const params = event.queryStringParameters || {};
        const invoiceId = params.invoice_id;

        if (!invoiceId) {
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
            .eq('id', invoiceId)
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
            .eq('invoice_id', invoiceId)
            .order('sort_order', { ascending: true });

        if (itemsError) {
            throw itemsError;
        }

        // PDF生成
        const pdfBuffer = await generateInvoicePDF(invoice, items || []);

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="invoice_${invoice.invoice_number}.pdf"`
            },
            body: pdfBuffer.toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('PDF生成エラー:', error);

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
                error: 'PDFの生成に失敗しました',
                details: error.message
            })
        };
    }
};

// PDF生成関数（invoice-generate.jsと同じ）
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

function formatDate(dateString) {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatNumber(num) {
    return parseFloat(num || 0).toLocaleString('ja-JP');
}
