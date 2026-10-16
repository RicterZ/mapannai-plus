import { z } from 'zod'
import type { ChatRequest } from '../lib/ai/protocol'
import { completionUrl, requestCompletion } from '../lib/ai/endpoint'
import { readCompletion } from '../lib/ai/completions'

/** These read-only generations may repair invalid JSON once, never replay map writes. */
export async function structuredCompletion<S extends z.ZodType>(request: ChatRequest, messages: { role: string; content: string | null }[], schema: S, signal: AbortSignal, complete = requestCompletion, validate?: (value: z.output<S>) => void): Promise<z.output<S>> {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    // Tool-only assistant turns become null after tools are stripped by stage callers.
    const textMessages = messages.filter(message => typeof message.content === 'string' && message.content.trim().length > 0)
    let failure = ''
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await complete(completionUrl(request.settings.baseUrl), request.settings.apiKey, {
            model: request.settings.model, stream: true,
            messages: attempt ? [...textMessages, { role: 'user', content: `上次输出未通过校验：${failure}\n请只输出要求的完整 JSON 对象，所有 schema 字段均须存在；未知字符串用空字符串，未知列表用空数组。日期必须为真实YYYY-MM-DD，禁止0000-00-00等占位，骨架严格覆盖已核实日期且连续不重复。不要输出解释或 Markdown。` }] : textMessages,
        }, timeout)
        const message = await readCompletion(response, () => {}, timeout)
        const raw = (message.content || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
        try { const parsed = schema.parse(JSON.parse(raw)); validate?.(parsed); return parsed } catch (error) {
            failure = (error instanceof z.ZodError
                ? error.issues.map(issue => `${issue.path.join('.') || '根对象'}: ${issue.message}`).join('；')
                : error instanceof SyntaxError ? '不是有效 JSON' : error instanceof Error ? error.message : '未知原因').slice(0, 1000)
            if (attempt) {
                const error = new Error('模型返回的结构化结果不符合要求')
                error.name = 'StructuredOutputError'
                throw error
            }
        }
    }
    throw new Error('Unreachable')
}
