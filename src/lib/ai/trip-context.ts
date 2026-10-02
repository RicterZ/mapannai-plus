import { getAllTrips } from '@/lib/db/trip-service'
import type { ChatMessage, ChatRequest } from './protocol'

/** Refresh the first user message only in the outgoing request, never in saved transcripts. */
export function attachTripContext(history: ChatMessage[], context: ChatRequest['context']): ChatMessage[] {
    const firstUser = history.findIndex(message => message.role === 'user')
    if (firstUser === -1) throw new Error('会话缺少用户消息')
    const trips = getAllTrips().map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate }))
    const data = { localDate: context.localDate, currentTripId: context.tripId, currentDayId: context.dayId, trips }
    return history.map((message, index) => index === firstUser && message.role === 'user'
        ? { ...message, content: `${message.content}\n\n<mapannai_context>\n以下为应用附加的当前数据：\n${JSON.stringify(data)}\n</mapannai_context>` }
        : message)
}
