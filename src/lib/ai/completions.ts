import { toolCallSchema, type ChatMessage, type ToolCall } from './protocol'

type Assistant = Extract<ChatMessage, { role: 'assistant' }>

export async function readCompletion(response: Response, onDelta: (text: string) => void, signal: AbortSignal): Promise<Assistant> {
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const json = await response.json()
        const message = json.choices?.[0]?.message
        if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new Error('AI API 未返回有效回复，请确认模型支持 Chat Completions 与工具调用')
        const assistant: Assistant = { role: 'assistant', content: message.content || null }
        if (message.tool_calls?.length) assistant.tool_calls = message.tool_calls.map((call: unknown) => toolCallSchema.parse(call))
        if (assistant.content) onDelta(assistant.content)
        return assistant
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('AI API 返回空回复')
    const decoder = new TextDecoder()
    let buffer = '', content = '', finished = false, received = false, total = 0
    const calls = new Map<number, ToolCall>()
    const consume = (frame: string) => {
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) return
        if (data === '[DONE]') { finished = true; return }
        const json = JSON.parse(data)
        if (json.error) throw new Error('AI API 生成失败，请检查模型与服务配置')
        const choice = json.choices?.[0]
        if (!choice) return
        received = true
        const delta = choice.delta || {}
        if (typeof delta.content === 'string') { content += delta.content; onDelta(delta.content) }
        for (const part of delta.tool_calls || []) {
            if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 16) throw new Error('AI 工具调用格式无效')
            const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (part.id) call.id += part.id
            if (part.function?.name) call.function.name += part.function.name
            if (part.function?.arguments) call.function.arguments += part.function.arguments
            calls.set(part.index, call)
        }
        if (choice.finish_reason) {
            if (choice.finish_reason === 'length') throw new Error('AI 回复达到长度限制，请缩小本次规划范围')
            finished = true
        }
    }
    try {
        while (true) {
            signal.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > 2_000_000) throw new Error('AI 回复过长，请缩小规划范围')
            buffer += decoder.decode(value, { stream: true })
            buffer = buffer.replace(/\r\n/g, '\n')
            let end: number
            while ((end = buffer.indexOf('\n\n')) !== -1) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2) }
        }
        buffer += decoder.decode()
        if (buffer.trim()) consume(buffer)
        if (!received || !finished) throw new Error('AI 回复中断，请重试；已完成的操作会保留')
        const tool_calls = Array.from(calls.entries()).sort(([a], [b]) => a - b).map(([, call]) => toolCallSchema.parse(call))
        if (!content && !tool_calls.length) throw new Error('AI API 返回空回复')
        return { role: 'assistant', content: content || null, ...(tool_calls.length ? { tool_calls } : {}) }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
