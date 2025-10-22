import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { adminAuthMiddleware } from '@/middleware/admin-auth'
import * as crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function generateUniqueCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(6)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

export const GET = adminAuthMiddleware(async (_request: NextRequest) => {
  try {
    const { data, error } = await supabase
      .from('tracking_links')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch tracking links' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

export const POST = adminAuthMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { source, campaign_name, created_by } = body

    if (!source || !campaign_name || !created_by) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    let code = generateUniqueCode()
    let attempts = 0
    const maxAttempts = 10

    while (attempts < maxAttempts) {
      const { data: existingLink } = await supabase
        .from('tracking_links')
        .select('id')
        .eq('code', code)
        .single()

      if (!existingLink) {
        break
      }

      code = generateUniqueCode()
      attempts++
    }

    if (attempts === maxAttempts) {
      return NextResponse.json(
        { error: 'Failed to generate unique code' },
        { status: 500 }
      )
    }

    const { data, error } = await supabase
      .from('tracking_links')
      .insert({
        code,
        source,
        campaign_name,
        created_by
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create tracking link' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

export const PUT = adminAuthMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { id, source, campaign_name, is_active } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing link ID' },
        { status: 400 }
      )
    }

    const updates: any = {}
    if (source !== undefined) updates.source = source
    if (campaign_name !== undefined) updates.campaign_name = campaign_name
    if (is_active !== undefined) updates.is_active = is_active

    const { data, error } = await supabase
      .from('tracking_links')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update tracking link' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

export const DELETE = adminAuthMiddleware(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing link ID' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('tracking_links')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete tracking link' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})