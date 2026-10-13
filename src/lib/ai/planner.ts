import { z } from 'zod'
import { chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatRequest } from './protocol'
import { connectPlanningTools, readOnlyTools } from './mcp-tools'
import { completionUrl, requestCompletion } from './endpoint'
import { readCompletion } from './completions'
import { planningPrompt } from './prompt'
import { attachTripContext } from './trip-context'

const changeTitleSchema = z.object({ title: z.string().trim().min(1).max(60) }).strict()
const changeTitleTool = { type: 'function' as const, function: {
    name: 'change_title', description: '修改当前网页会话的标题，概括用户的旅游意图。',
    parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 60, description: '简短的会话标题，例如东京秋日旅行' } }, required: ['title'], additionalProperties: false },
} }

type Dependencies = {
    connect?: typeof connectPlanningTools
    complete?: typeof requestCompletion
}

export async function runPlanner(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal, deps: Dependencies = {}) {
    const url = completionUrl(request.settings.baseUrl)
    const bridge = await (deps.connect || connectPlanningTools)()
    const history = repairInterruptedMessages(request.messages)
    const tools = [...bridge.tools, changeTitleTool]
    const available = new Set(tools.map(tool => tool.function.name))
    try {
        for (let round = 0; round < 16; round++) {
            signal.throwIfAborted()
            if (history.length > 180) throw new Error('会话记录已较长，请新建会话继续规划；已完成的操作会保留。')
            const timeout = AbortSignal.timeout(120_000)
            const upstreamSignal = AbortSignal.any([signal, timeout])
            const response = await (deps.complete || requestCompletion)(url, request.settings.apiKey, {
                model: request.settings.model, messages: [{ role: 'system', content: planningPrompt }, ...attachTripContext(history, request.context)],
                tools, tool_choice: 'auto', stream: true,
            }, upstreamSignal)
            const assistant = chatMessageSchema.parse(await readCompletion(response, text => emit({ type: 'delta', text }), upstreamSignal))
            if (assistant.role !== 'assistant') throw new Error('AI 回复格式无效')
            // Validate the entire batch before executing any side effects.
            const ids = new Set<string>()
            for (const call of assistant.tool_calls || []) {
                if (ids.has(call.id)) throw new Error('AI 返回重复工具调用 ID')
                ids.add(call.id)
            }
            history.push(assistant)
            emit({ type: 'message', message: assistant })
            if (!assistant.tool_calls?.length) { emit({ type: 'complete' }); return }
            for (const call of assistant.tool_calls) {
                signal.throwIfAborted()
                emit({ type: 'status', name: call.function.name })
                let result: unknown
                let invoked = false
                try {
                    if (!available.has(call.function.name)) throw new Error('未提供此工具')
                    const args = JSON.parse(call.function.arguments)
                    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
                    if (call.function.name === 'change_title') {
                        const { title } = changeTitleSchema.parse(args)
                        emit({ type: 'title', title })
                        result = { content: [{ type: 'text', text: JSON.stringify({ title }) }] }
                    } else {
                        invoked = true
                        result = await bridge.call(call.function.name, args, signal)
                    }
                } catch {
                    if (signal.aborted) throw new Error('请求已停止；正在执行的工具可能已保存数据，请查询后继续')
                    result = { isError: true, content: [{ type: 'text', text: '工具执行失败或参数无效。先检查参数并查询当前数据，避免重复写入。' }] }
                } finally {
                    // A tool can write partially and then fail; refresh even in that case.
                    if (invoked && !readOnlyTools.has(call.function.name)) emit({ type: 'changed' })
                }
                const message = chatMessageSchema.parse({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) })
                history.push(message)
                emit({ type: 'message', message })
            }
        }
        throw new Error('本轮工具调用较多，已暂停。已完成的操作已保存，可继续发送消息规划剩余部分。')
    } finally { await bridge.close() }
}
