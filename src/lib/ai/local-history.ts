import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { MAX_AI_HISTORY_MESSAGES, aiSettingsSchema, chatMessageSchema, type AiSettings } from './protocol'

export const HISTORY_KEY = 'mapannai:ai-history:v1'
export const SETTINGS_KEY = 'mapannai:ai-settings:v1'
const conversationSchema = z.object({
    id: z.string(), title: z.string(), updatedAt: z.string(),
    messages: z.array(chatMessageSchema).max(MAX_AI_HISTORY_MESSAGES + 20),
})
const historySchema = z.object({ version: z.literal(1), activeId: z.string().nullable(), conversations: z.array(conversationSchema).max(20) })
const settingsSchema = aiSettingsSchema.extend({ rememberKey: z.boolean() })
export type Conversation = z.infer<typeof conversationSchema>
export type LocalHistory = z.infer<typeof historySchema>
export type LocalSettings = AiSettings & { rememberKey: boolean }
export const emptyHistory: LocalHistory = { version: 1, activeId: null, conversations: [] }
export const defaultSettings: LocalSettings = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', rememberKey: false }

export function readHistory(storage: Pick<Storage, 'getItem'>): LocalHistory {
    const value = storage.getItem(HISTORY_KEY)
    return value ? historySchema.parse(JSON.parse(value)) : { ...emptyHistory, conversations: [] }
}
// Interaction/review results carry approval state and must stay intact; other tool output can be shortened.
const PRESERVED_TOOLS = new Set(['ask_datetime', 'ask_choice', 'preview_itinerary', 'submit_trip_review', 'finish_planning_day', 'change_title', 'record_plan_skeleton'])
const COMPACT_TOOL_CHARS = 2000
type HistoryMessage = Conversation['messages'][number]
function compactMessage(message: HistoryMessage): HistoryMessage {
    if (message.role !== 'tool' || PRESERVED_TOOLS.has(message.name || '') || message.content.length <= COMPACT_TOOL_CHARS) return message
    let isError = false
    try { isError = JSON.parse(message.content)?.isError === true } catch { /* Non-JSON output is still shortened. */ }
    return { ...message, content: JSON.stringify({ ...(isError ? { isError } : {}), truncated: true, content: [{ type: 'text', text: `${message.content.slice(0, COMPACT_TOOL_CHARS)}\n[本地记录已截断，需要时请重新查询]` }] }) }
}

/** Saves history, shortening old tool output and then dropping the oldest inactive conversations when storage is full. Returns false if even the minimum does not fit. */
export function writeHistory(storage: Pick<Storage, 'setItem'>, history: LocalHistory): { saved: boolean; compacted: boolean } {
    const attempt = (value: LocalHistory) => { try { storage.setItem(HISTORY_KEY, JSON.stringify(value)); return true } catch { return false } }
    if (attempt(history)) return { saved: true, compacted: false }
    const compacted = { ...history, conversations: history.conversations.map(item => ({ ...item, messages: item.messages.map(compactMessage) })) }
    while (true) {
        if (attempt(compacted)) return { saved: true, compacted: true }
        const dropIndex = compacted.conversations.map(item => item.id !== history.activeId).lastIndexOf(true)
        if (dropIndex < 0) return { saved: false, compacted: true }
        compacted.conversations = compacted.conversations.filter((_, index) => index !== dropIndex)
    }
}
export function readSettings(storage: Pick<Storage, 'getItem'>): LocalSettings {
    const value = storage.getItem(SETTINGS_KEY)
    if (!value) return { ...defaultSettings }
    const settings = settingsSchema.parse(JSON.parse(value))
    return { ...settings, apiKey: settings.rememberKey ? settings.apiKey : '' }
}
export function writeSettings(storage: Pick<Storage, 'setItem'>, settings: LocalSettings) {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, apiKey: settings.rememberKey ? settings.apiKey : '' }))
}
export function newConversation(): Conversation {
    return { id: uuidv4(), title: '新会话', messages: [], updatedAt: new Date().toISOString() }
}
