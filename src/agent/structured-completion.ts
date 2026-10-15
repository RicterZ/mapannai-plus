import { z } from 'zod'
import type { ChatRequest } from '../lib/ai/protocol'
import { completionUrl, requestCompletion } from '../lib/ai/endpoint'
import { readCompletion } from '../lib/ai/completions'

/** These read-only generations may repair invalid JSON once, never replay map writes. */
export async function structuredCompletion<S extends z.ZodType>(request: ChatRequest, messages: { role: string; content: string | null }[], schema: S, signal: AbortSignal, complete = requestCompletion): Promise<z.output<S>> {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    // Tool-only assistant turns become null after tools are stripped by stage callers.
    const textMessages = messages.filter(message => typeof message.content === 'string' && message.content.trim().length > 0)
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await complete(completionUrl(request.settings.baseUrl), request.settings.apiKey, {
            model: request.settings.model, stream: true,
            messages: attempt ? [...textMessages, { role: 'user', content: '上次输出未通过 JSON 格式校验。请只输出要求的完整 JSON 对象，所有 schema 字段均须存在；未知字符串用空字符串，未知列表用空数组。不要输出解释或 Markdown。' }] : textMessages,
        }, timeout)
        const message = await readCompletion(response, () => {}, timeout)
        const raw = (message.content || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
        try { return schema.parse(JSON.parse(raw)) } catch {
            if (attempt) {
                const error = new Error('模型返回的结构化结果不符合要求')
                error.name = 'StructuredOutputError'
                throw error
            }
        }
    }
    throw new Error('Unreachable')
}
