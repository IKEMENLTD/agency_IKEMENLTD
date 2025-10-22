import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const { data: links, error: linksError } = await supabaseAdmin
      .from('tracking_links')
      .select('*')
      .order('created_at', { ascending: false })

    if (linksError) {
      return NextResponse.json(
        { error: 'Failed to fetch tracking links' },
        { status: 500 }
      )
    }

    let sessionsQuery = supabaseAdmin
      .from('tracking_sessions')
      .select('*')

    if (startDate) {
      sessionsQuery = sessionsQuery.gte('created_at', startDate)
    }

    if (endDate) {
      sessionsQuery = sessionsQuery.lte('created_at', endDate)
    }

    const { data: sessions, error: sessionsError } = await sessionsQuery

    if (sessionsError) {
      return NextResponse.json(
        { error: 'Failed to fetch sessions' },
        { status: 500 }
      )
    }

    const analytics = links.map(link => {
      const linkSessions = sessions?.filter(s => s.tracking_link_id === link.id) || []
      const friendAddedSessions = linkSessions.filter(s => s.line_user_id && s.friend_added_at)
      const botSessions = linkSessions.filter(s => s.is_bot)
      const humanSessions = linkSessions.filter(s => !s.is_bot)

      return {
        id: link.id,
        code: link.code,
        source: link.source,
        campaign_name: link.campaign_name,
        created_at: link.created_at,
        click_count: link.click_count,
        friend_count: link.friend_count,
        is_active: link.is_active,
        analytics: {
          total_clicks: linkSessions.length,
          human_clicks: humanSessions.length,
          bot_clicks: botSessions.length,
          conversions: friendAddedSessions.length,
          conversion_rate: humanSessions.length > 0
            ? ((friendAddedSessions.length / humanSessions.length) * 100).toFixed(2) + '%'
            : '0%',
          unique_ips: [...new Set(linkSessions.map(s => s.ip_address))].length,
          recent_activity: linkSessions.slice(0, 5).map(s => ({
            created_at: s.created_at,
            is_bot: s.is_bot,
            converted: !!s.line_user_id
          }))
        }
      }
    })

    const summary = {
      total_links: links.length,
      active_links: links.filter(l => l.is_active).length,
      total_clicks: sessions?.length || 0,
      total_conversions: sessions?.filter(s => s.line_user_id && s.friend_added_at).length || 0,
      total_human_clicks: sessions?.filter(s => !s.is_bot).length || 0,
      total_bot_clicks: sessions?.filter(s => s.is_bot).length || 0,
      overall_conversion_rate:
        sessions && sessions.filter(s => !s.is_bot).length > 0
          ? ((sessions.filter(s => s.line_user_id && s.friend_added_at && !s.is_bot).length /
              sessions.filter(s => !s.is_bot).length) * 100).toFixed(2) + '%'
          : '0%',
      top_sources: getTopSources(links, sessions || []),
      hourly_distribution: getHourlyDistribution(sessions || [])
    }

    return NextResponse.json({
      summary,
      links: analytics
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function getTopSources(links: any[], sessions: any[]): any[] {
  const sourceStats = new Map<string, { clicks: number; conversions: number }>()

  links.forEach(link => {
    const linkSessions = sessions.filter(s => s.tracking_link_id === link.id)
    const conversions = linkSessions.filter(s => s.line_user_id && s.friend_added_at).length

    if (sourceStats.has(link.source)) {
      const stats = sourceStats.get(link.source)!
      stats.clicks += linkSessions.length
      stats.conversions += conversions
    } else {
      sourceStats.set(link.source, {
        clicks: linkSessions.length,
        conversions: conversions
      })
    }
  })

  return Array.from(sourceStats.entries())
    .map(([source, stats]) => ({
      source,
      clicks: stats.clicks,
      conversions: stats.conversions,
      conversion_rate: stats.clicks > 0
        ? ((stats.conversions / stats.clicks) * 100).toFixed(2) + '%'
        : '0%'
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)
}

function getHourlyDistribution(sessions: any[]): number[] {
  const hourly = new Array(24).fill(0)

  sessions.forEach(session => {
    const hour = new Date(session.created_at).getHours()
    hourly[hour]++
  })

  return hourly
}