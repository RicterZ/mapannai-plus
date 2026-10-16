import type { ChatMessage } from '../lib/ai/protocol'
export function reviewState(messages: ChatMessage[]) {
    let approved = false, completed = false
    for (const message of messages) {
        if (message.role !== 'tool') continue
        try {
            const result = JSON.parse(message.content)
            if (message.name === 'preview_itinerary') {
                approved = result.status === 'selected' && result.selection?.action === 'continue'
                completed = false
            }
            if (message.name === 'submit_trip_review' && result.verified === true) completed = true
        } catch { /* Invalid history does not authorize writes. */ }
    }
    return { approved, completed }
}

/** Explicit user evidence only; completion and newer preview decisions invalidate older waivers. */
export function hasReviewWaiver(messages: ChatMessage[], quote?: string): boolean {
    if (!quote?.trim()) return false
    let index = -1
    messages.forEach((message, i) => { if (message.role === 'user' && message.content.includes(quote)) index = i })
    if (index < 0) return false
    return !messages.slice(index + 1).some(message => {
        if (message.role !== 'tool' || !['preview_itinerary', 'submit_trip_review'].includes(message.name || '')) return false
        try { const result = JSON.parse(message.content); return message.name === 'preview_itinerary' || result.verified === true } catch { return true }
    })
}
