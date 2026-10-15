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
