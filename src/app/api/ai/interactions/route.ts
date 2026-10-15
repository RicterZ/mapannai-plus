import { NextRequest } from 'next/server'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
    const body = await request.text()
    if (body.length > 16000) return new Response(null, { status: 413 })
    try {
        const response = await fetch(new URL('/interactions', process.env.AGENT_URL || 'http://127.0.0.1:3100'), {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.AGENT_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_TOKEN}` } : {}) },
            body, signal: AbortSignal.timeout(5000),
        })
        return new Response(null, { status: response.status })
    } catch { return new Response(null, { status: 502 }) }
}
