import { z } from 'zod'
import { aiSettingsSchema, chatMessageSchema, type AiSettings } from './protocol'

export const HISTORY_KEY = 'mapannai:ai-history:v1'
export const SETTINGS_KEY = 'mapannai:ai-settings:v1'
const conversationSchema = z.object({
    id: z.string(), title: z.string(), updatedAt: z.string(),
    messages: z.array(chatMessageSchema).max(250),
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
    return { id: crypto.randomUUID(), title: '新会话', messages: [], updatedAt: new Date().toISOString() }
}
