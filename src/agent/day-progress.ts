import type { ChatMessage } from '../lib/ai/protocol'

export function completedDates(messages: ChatMessage[]): Set<string> {
    const dates = new Set<string>()
    for (const message of messages) {
        if (message.role !== 'tool' || message.name !== 'finish_planning_day') continue
        try {
            const result = JSON.parse(message.content)
            if (!result.isError && result.date && result.verified === true) dates.add(result.date)
        } catch { /* Interrupted or malformed results do not advance progress. */ }
    }
    return dates
}

/** Validate the actual saved day, not the model's claim that it finished. */
export function verifySavedDay(detail: unknown, dayId: string, expectedDate?: string) {
    const trip = detail as { days?: { id: string; date: string; title?: string; markerIds: string[]; chains: string[][] }[] }
    const day = trip.days?.find(day => day.id === dayId)
    if (!day || (expectedDate && day.date !== expectedDate)) throw new Error('必须先完成当前日期')
    if (!day.title?.trim()) throw new Error('请先保存当天名称')
    const ids = new Set(day.markerIds)
    if (!ids.size) throw new Error('当天尚无有效地点')
    if (day.chains.some(chain => chain.some(id => !ids.has(id)))) throw new Error('路线存在非当天成员')
    if (ids.size >= 2 && !day.chains.some(chain => chain.length >= 2)) throw new Error('请先保存当天有序路线')
    return { date: day.date, dayId: day.id, verified: true }
}

export const progressTools: { type: 'function'; function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, object>; required: string[]; additionalProperties: boolean } } }[] = [
    { type: 'function' as const, function: { name: 'finish_planning_day', description: '当天名称、成员、路线保存后读取核实并标记完成；必须按每日骨架顺序完成后再继续下一天', parameters: { type: 'object' as const, properties: { tripId: { type: 'string' }, dayId: { type: 'string' } }, required: ['tripId', 'dayId'], additionalProperties: false } } },
    { type: 'function' as const, function: { name: 'submit_trip_review', description: '所有相关日期已完成并核实后提交整体审阅，本轮后续禁止写入，等待用户批准或整改意见', parameters: { type: 'object' as const, properties: { tripId: { type: 'string' } }, required: ['tripId'], additionalProperties: false } } },
]
