import { z } from 'zod'
const base = { question: z.string().min(1).max(300) }
export const interactionSchema = z.discriminatedUnion('kind', [
    z.object({ ...base, kind: z.literal('ask_choice'), multiple: z.boolean().default(false), maxSelections: z.number().int().min(1).max(20).default(1), options: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(100), description: z.string().max(300).optional() }).strict()).min(2).max(20) }).strict(),
    z.object({ ...base, kind: z.literal('ask_datetime'), mode: z.enum(['date','date_range','time','datetime','datetime_range']), timezone: z.string().max(80) }).strict(),
    z.object({ ...base, kind: z.literal('preview_itinerary'), title: z.string().max(100), days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().max(100), places: z.array(z.string().max(150)).max(30) }).strict()).min(1).max(90) }).strict(),
])
export type Interaction = z.infer<typeof interactionSchema>
export type InteractionPrompt = { id: string; token: string; deadline: number; input: Interaction }
export function validateSelection(input: Interaction, value: unknown) {
    if (input.kind === 'ask_choice') {
        const selected = z.array(z.string()).min(1).max(input.multiple ? input.maxSelections : 1).parse(value)
        if (new Set(selected).size !== selected.length || selected.some(id => !input.options.some(option => option.id === id))) throw new Error('Invalid selection')
        return selected
    }
    if (input.kind === 'preview_itinerary') return z.object({ action: z.enum(['continue','revise']), feedback: z.string().max(2000) }).strict().parse(value)
    const range = input.mode.endsWith('_range')
    const result = z.object({ start: z.string().min(1).max(40), end: z.string().max(40).optional() }).strict().parse(value)
    const pattern = input.mode === 'time' ? /^([01]\d|2[0-3]):[0-5]\d$/ : input.mode.startsWith('datetime') ? /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/ : /^\d{4}-\d{2}-\d{2}$/
    for (const value of [result.start, ...(range ? [result.end || ''] : [])]) {
        if (!pattern.test(value)) throw new Error('Invalid date/time')
        if (input.mode !== 'time') { const date = value.slice(0,10); if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Invalid date') }
    }
    if (range && result.end! < result.start) throw new Error('Invalid range')
    return result
}
export const interactionTools = interactionSchema.options.map(schema => {
    const json = z.toJSONSchema(schema) as Record<string, unknown>
    const { kind: _kind, ...properties } = json.properties as Record<string, unknown>
    return { type: 'function' as const, function: { name: schema.shape.kind.value, description: '向用户展示交互卡片并等待最多30秒。超时不代表选择或授权，不编造实际日期/预订；可明确标注假设后继续草案。preview仅为草案审阅，不授权保存或删除。', parameters: { ...json, properties, required: (json.required as string[]).filter(key => key !== 'kind') } } }
})
