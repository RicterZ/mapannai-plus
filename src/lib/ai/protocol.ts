import type { InteractionPrompt } from './interaction'
import { z } from 'zod'

export const toolCallSchema = z.object({
    id: z.string().min(1).max(200),
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(200_000) }),
})
export const chatMessageSchema = z.discriminatedUnion('role', [
    z.object({ role: z.literal('user'), content: z.string().min(1).max(30_000) }),
    z.object({ role: z.literal('assistant'), content: z.string().max(200_000).nullable(), tool_calls: z.array(toolCallSchema).max(16).optional() }),
    z.object({ role: z.literal('tool'), content: z.string().max(1_000_000), tool_call_id: z.string().min(1).max(200), name: z.string().max(100).optional() }),
])
export const aiSettingsSchema = z.object({
    baseUrl: z.string().min(1).max(2048),
    apiKey: z.string().max(4096).refine(value => !/[\r\n]/.test(value)),
    model: z.string().trim().min(1).max(200),
})
export const chatRequestSchema = z.object({
    settings: aiSettingsSchema,
    conversationId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    supportsInteractions: z.boolean().optional(),
    messages: z.array(chatMessageSchema).min(1).max(200),
    context: z.object({
        localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        tripId: z.string().max(200).nullable(),
        dayId: z.string().max(200).nullable(),
    }),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>
export type ToolCall = z.infer<typeof toolCallSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatEvent =
    | { type: 'partial'; text: string }
    | { type: 'interaction'; prompt: InteractionPrompt }
    | { type: 'delta'; text: string }
    | { type: 'message'; message: ChatMessage }
    | { type: 'status'; name: string }
    | { type: 'title'; title: string }
    | { type: 'changed' }
    | { type: 'complete' }
    | { type: 'error'; message: string }

/** Complete interrupted tool batches without ever replaying their side effects. */
export function repairInterruptedMessages(messages: ChatMessage[]): ChatMessage[] {
    const repaired: ChatMessage[] = []
    let pending: ToolCall[] = []
    const flush = () => {
        for (const call of pending) repaired.push({
            role: 'tool', tool_call_id: call.id, name: call.function.name,
            content: JSON.stringify({ error: '上次请求已中断，此工具结果未知；先查询实际数据，不要重复执行写入操作。' }),
        })
        pending = []
    }
    for (const message of messages) {
        if (message.role === 'tool') {
            const index = pending.findIndex(call => call.id === message.tool_call_id)
            if (index === -1) continue
            pending.splice(index, 1)
            repaired.push(message)
        } else {
            flush()
            repaired.push(message)
            if (message.role === 'assistant') pending = [...(message.tool_calls || [])]
        }
    }
    flush()
    return repaired
}

export const toolLabels: Record<string, string> = {
    ask_datetime: '选择日期时间', ask_choice: '选择偏好', preview_itinerary: '预览行程',
    change_title: '修改会话标题',
    record_plan_skeleton: '制定全程骨架', finish_planning_day: '核实当天安排', submit_trip_review: '提交行程审阅',
    update_trip: '更新旅行', update_trip_day: '更新每日安排', delete_trip_day: '删除行程日',
    update_day_chain: '调整路线安排', delete_day_chain: '删除路线',
    search_destinations: '查询目的地', search_web: '搜索旅行资料', fetch_web: '阅读网页资料',
    list_markers: '查看已收藏地点', create_marker: '收藏地点', update_marker: '更新地点', delete_marker: '删除地点',
    search_places: '搜索地点', get_place_details: '查询地点详情', get_directions: '查询路线', get_walking_directions: '查询步行路线',
    list_trips: '查看已有旅行', get_trip_detail: '查看旅行安排', create_trip: '创建旅行', add_day_to_trip: '添加行程日',
    assign_marker_to_day: '安排当天地点', plan_trip_day: '规划当天行程', create_day_chain: '建立路线',
    reorder_day_markers: '调整地点顺序', delete_trip: '删除旅行',
}
