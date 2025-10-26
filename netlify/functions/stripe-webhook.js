const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getCorsHeaders, handleCorsPreflightRequest } = require('./utils/cors-headers');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
    const headers = getCorsHeaders(event, {
        // Secure CORS - see getCorsHeaders(),
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const sig = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let stripeEvent;

    try {
        // Verify webhook signature
        stripeEvent = stripe.webhooks.constructEvent(
            event.body,
            sig,
            webhookSecret
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err);
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
        };
    }

    try {
        // Handle different event types
        switch (stripeEvent.type) {
            case 'payment_intent.succeeded':
                await handlePaymentSuccess(stripeEvent.data.object);
                break;

            case 'checkout.session.completed':
                await handleCheckoutComplete(stripeEvent.data.object);
                break;

            case 'customer.created':
                await handleCustomerCreated(stripeEvent.data.object);
                break;

            case 'invoice.payment_succeeded':
                await handleInvoicePayment(stripeEvent.data.object);
                break;

            default:
                console.log(`Unhandled event type: ${stripeEvent.type}`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ received: true })
        };

    } catch (error) {
        console.error('Webhook processing error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Webhook processing failed' })
        };
    }
};

async function handlePaymentSuccess(paymentIntent) {
    console.log('Processing successful payment:', paymentIntent.id);

    // Extract metadata for tracking attribution
    const metadata = paymentIntent.metadata || {};
    const {
        line_user_id,
        tracking_code,
        session_id,
        agency_id,
        user_id
    } = metadata;

    if (!agency_id && !tracking_code) {
        console.log('No agency attribution found for payment');
        return;
    }

    try {
        // Find the tracking link and agency
        let agencyData = null;
        let trackingLink = null;

        if (tracking_code) {
            const { data: link } = await supabase
                .from('agency_tracking_links')
                .select(`
                    *,
                    agencies (*)
                `)
                .eq('tracking_code', tracking_code)
                .single();

            if (link) {
                trackingLink = link;
                agencyData = link.agencies;
            }
        } else if (agency_id) {
            const { data: agency } = await supabase
                .from('agencies')
                .select('*')
                .eq('id', agency_id)
                .single();

            agencyData = agency;
        }

        if (!agencyData) {
            console.log('Agency not found for payment attribution');
            return;
        }

        // Find the visit record if session_id exists
        let visitId = null;
        if (session_id) {
            const { data: visit } = await supabase
                .from('agency_tracking_visits')
                .select('id')
                .eq('session_id', session_id)
                .single();

            if (visit) {
                visitId = visit.id;
            }
        }

        // Record the conversion
        const { data: conversion, error: conversionError } = await supabase
            .from('agency_conversions')
            .insert({
                tracking_link_id: trackingLink?.id,
                agency_id: agencyData.id,
                visit_id: visitId,
                user_id: user_id || null,
                conversion_type: 'stripe_payment',
                conversion_value: paymentIntent.amount / 100, // Convert from cents to currency
                line_user_id: line_user_id || null,
                metadata: {
                    stripe_payment_intent_id: paymentIntent.id,
                    stripe_customer_id: paymentIntent.customer,
                    currency: paymentIntent.currency,
                    payment_method: paymentIntent.payment_method_types[0],
                    description: paymentIntent.description,
                    timestamp: new Date().toISOString()
                }
            })
            .select()
            .single();

        if (conversionError) {
            console.error('Error recording conversion:', conversionError);
            return;
        }

        // Update tracking link conversion count if applicable
        if (trackingLink) {
            await supabase
                .from('agency_tracking_links')
                .update({
                    conversion_count: trackingLink.conversion_count + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', trackingLink.id);
        }

        // Calculate and update commission
        const commissionAmount = (paymentIntent.amount / 100) * (agencyData.commission_rate / 100);

        // Get or create current month's commission record
        const currentDate = new Date();
        const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        const { data: existingCommission } = await supabase
            .from('agency_commissions')
            .select('*')
            .eq('agency_id', agencyData.id)
            .gte('period_start', periodStart.toISOString())
            .lte('period_end', periodEnd.toISOString())
            .single();

        if (existingCommission) {
            // Update existing commission record
            await supabase
                .from('agency_commissions')
                .update({
                    total_conversions: existingCommission.total_conversions + 1,
                    total_sales: existingCommission.total_sales + (paymentIntent.amount / 100),
                    commission_amount: existingCommission.commission_amount + commissionAmount,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingCommission.id);
        } else {
            // Create new commission record
            await supabase
                .from('agency_commissions')
                .insert({
                    agency_id: agencyData.id,
                    period_start: periodStart.toISOString(),
                    period_end: periodEnd.toISOString(),
                    total_conversions: 1,
                    total_sales: paymentIntent.amount / 100,
                    commission_rate: agencyData.commission_rate,
                    commission_amount: commissionAmount,
                    status: 'pending'
                });
        }

        console.log(`Conversion recorded for agency ${agencyData.name}: ¥${paymentIntent.amount / 100}`);

    } catch (error) {
        console.error('Error processing payment conversion:', error);
    }
}

async function handleCheckoutComplete(session) {
    console.log('Processing checkout completion:', session.id);

    // Similar logic to handlePaymentSuccess but for checkout sessions
    const metadata = session.metadata || {};

    if (metadata.tracking_code || metadata.agency_id) {
        // Retrieve the payment intent to get the actual payment details
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);

        // Process the payment with metadata
        await handlePaymentSuccess({
            ...paymentIntent,
            metadata: {
                ...paymentIntent.metadata,
                ...metadata
            }
        });
    }
}

async function handleCustomerCreated(customer) {
    console.log('New customer created:', customer.id);

    // Store customer information if there's LINE user attribution
    const metadata = customer.metadata || {};

    if (metadata.line_user_id && metadata.agency_id) {
        // Update user record with Stripe customer ID
        await supabase
            .from('users')
            .update({
                stripe_customer_id: customer.id,
                metadata: {
                    stripe_customer_created: new Date().toISOString(),
                    agency_id: metadata.agency_id
                }
            })
            .eq('line_user_id', metadata.line_user_id);
    }
}

async function handleInvoicePayment(invoice) {
    console.log('Invoice payment succeeded:', invoice.id);

    // Handle subscription or recurring payments
    if (invoice.subscription && invoice.metadata) {
        const metadata = invoice.metadata;

        if (metadata.tracking_code || metadata.agency_id) {
            await handlePaymentSuccess({
                id: invoice.payment_intent,
                amount: invoice.amount_paid,
                currency: invoice.currency,
                customer: invoice.customer,
                payment_method_types: ['card'],
                description: `Invoice ${invoice.number}`,
                metadata
            });
        }
    }
}