import { NextResponse } from 'next/server'
import { planningPrompt } from '@/lib/ai/prompt'

export const dynamic = 'force-dynamic'

/** The same system prompt used by the server planner, for native clients. */
export async function GET() {
    return NextResponse.json({ prompt: planningPrompt }, {
        headers: { 'Cache-Control': 'no-store' },
    })
}
