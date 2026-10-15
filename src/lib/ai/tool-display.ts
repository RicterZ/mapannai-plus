import type { ChatMessage } from './protocol'

export function toolFailed(message: Extract<ChatMessage, { role: 'tool' }>): boolean {
    try {
        const result = JSON.parse(message.content)
        return !!result.isError || !!result.error || !!result.content?.some((part: { type: string; text?: string }) => {
            if (part.type !== 'text' || !part.text) return false
            try { return JSON.parse(part.text).results?.some((item: { status?: string }) => item.status === 'error') } catch { return false }
        })
    } catch { return true }
}

/** Tool-only assistant turns must not split one continuous progress group. */
export function groupChatMessages(messages: ChatMessage[]): ({ type: 'message'; message: ChatMessage } | { type: 'tools'; messages: Extract<ChatMessage, { role: 'tool' }>[] })[] {
    const groups: ReturnType<typeof groupChatMessages> = []
    for (const message of messages) {
        if (message.role === 'assistant' && !message.content) continue
        if (message.role === 'tool') {
            const last = groups[groups.length - 1]
            if (last?.type === 'tools') last.messages.push(message)
            else groups.push({ type: 'tools', messages: [message] })
        } else groups.push({ type: 'message', message })
    }
    return groups
}
