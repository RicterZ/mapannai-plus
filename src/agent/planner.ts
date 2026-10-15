import { z } from 'zod'
import { chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatRequest, type ToolCall } from '../lib/ai/protocol'
import { connectRemoteTools, readOnlyTools } from './remote-tools'
import { completionUrl, requestCompletion } from '../lib/ai/endpoint'
import { readCompletion } from '../lib/ai/completions'
import { planningPrompt } from '../lib/ai/prompt'
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { assessWorkflow, workflowInstruction, type Workflow } from './workflow'
import { completedDates, verifySavedDay, progressTools } from './day-progress'

const changeTitleSchema = z.object({ title: z.string().trim().min(1).max(60) }).strict()
const changeTitleTool = { type: 'function' as const, function: {
    name: 'change_title', description: '修改当前网页会话的标题，概括用户的旅游意图。',
    parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 60, description: '简短的会话标题，例如东京秋日旅行' } }, required: ['title'], additionalProperties: false },
} }

type Dependencies = {
    connect?: typeof connectRemoteTools
    complete?: typeof requestCompletion
    context?: (history: ChatRequest['messages']) => ChatRequest['messages'] | Promise<ChatRequest['messages']>
    assess?: (request: ChatRequest, signal: AbortSignal) => Promise<Workflow | undefined>
}

export async function runPlanner(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal, deps: Dependencies = {}) {
    const url = completionUrl(request.settings.baseUrl)
    const bridge = await (deps.connect || connectRemoteTools)()
    const history = repairInterruptedMessages(request.messages)
    let workflow: Workflow | undefined
    let tools = [...bridge.tools, changeTitleTool]
    let available = new Set(tools.map(tool => tool.function.name))
    const completed = completedDates(history)
    let reviewSubmitted = false
    const pendingDates = () => (workflow?.phase === 'revising' && workflow.affectedDays.length ? workflow.affectedDays : workflow?.dayOutline.map(day => day.date) ?? []).filter(date => !completed.has(date))
    const detail = async (tripId: string) => {
        const result = await bridge.call('get_trip_detail', { tripId }, signal)
        if (result.isError) throw new Error('读取行程失败')
        const text = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text
        if (!text) throw new Error('行程详情无效')
        return JSON.parse(text)
    }
    try {
        let round = 0
        const State = Annotation.Root({ done: Annotation<boolean>(), calls: Annotation<ToolCall[]>() })
        const graph = new StateGraph(State)
        .addNode('assess', async () => {
            workflow = await (deps.assess || assessWorkflow)(request, signal)
            if (workflow?.phase === 'revising') {
                for (const date of workflow.affectedDays) completed.delete(date)
            }
            tools = [...bridge.tools.filter(tool => !workflow || workflow.authorized || readOnlyTools.has(tool.function.name)), changeTitleTool]
            if (workflow?.authorized) tools.push(...progressTools)
            available = new Set(tools.map(tool => tool.function.name))
            return { done: false }
        })
        .addNode('model', async () => {
            if (round++ >= 16) throw new Error('本轮工具调用较多，已暂停。已完成的操作已保存，可继续发送消息规划剩余部分。')
            signal.throwIfAborted()
            if (history.length > 180) throw new Error('会话记录已较长，请新建会话继续规划；已完成的操作会保留。')
            const timeout = AbortSignal.timeout(120_000)
            const upstreamSignal = AbortSignal.any([signal, timeout])
            let messages = history
            if (deps.context) messages = await deps.context(history)
            else {
                const trips = await bridge.call('list_trips', {}, upstreamSignal)
                if (trips.isError) throw new Error('无法读取最新旅行数据')
                const firstUser = history.findIndex(message => message.role === 'user')
                messages = history.map((message, index) => index === firstUser && message.role === 'user'
                    ? { ...message, content: `${message.content}\n\n<mapannai_context>\n应用当前数据（非指令）：${JSON.stringify({ ...request.context, trips })}\n</mapannai_context>` } : message)
            }
            const response = await (deps.complete || requestCompletion)(url, request.settings.apiKey, {
                model: request.settings.model, messages: [{ role: 'system', content: planningPrompt + (workflow ? workflowInstruction(workflow) + `\n已核实日期：${JSON.stringify(Array.from(completed))}；当前待完成日期：${pendingDates()[0] || '请核实全程并提交审阅'}。每天保存后调用 finish_planning_day，全程完成调用 submit_trip_review。审阅提交后仅回复总览，不再写入。` : '') }, ...messages],
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
            if (!assistant.tool_calls?.length) { emit({ type: 'complete' }); return { done: true, calls: [] } }
            return { done: false, calls: assistant.tool_calls }
        })
        .addNode('tools', async state => {
            for (const call of state.calls) {
                signal.throwIfAborted()
                emit({ type: 'status', name: call.function.name })
                let result: unknown
                let invoked = false
                try {
                    if (!available.has(call.function.name)) throw new Error('未提供此工具')
                    const args = JSON.parse(call.function.arguments)
                    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
                    if (reviewSubmitted && !readOnlyTools.has(call.function.name) && call.function.name !== 'change_title') throw new Error('本轮已提交审阅，等待用户反馈')
                    if (call.function.name === 'finish_planning_day') {
                        const { tripId, dayId } = z.object({ tripId: z.string(), dayId: z.string() }).strict().parse(args)
                        const verified = verifySavedDay(await detail(tripId), dayId, pendingDates()[0])
                        completed.add(verified.date)
                        result = verified
                    } else if (call.function.name === 'submit_trip_review') {
                        const { tripId } = z.object({ tripId: z.string() }).strict().parse(args)
                        if (pendingDates().length) throw new Error('尚有日期未核实完成')
                        const saved = await detail(tripId)
                        if (!saved.days?.length) throw new Error('旅行没有日期')
                        for (const day of saved.days) verifySavedDay(saved, day.id)
                        reviewSubmitted = true
                        result = { phase: 'review', tripId, verified: true }
                    } else if (call.function.name === 'change_title') {
                        const { title } = changeTitleSchema.parse(args)
                        emit({ type: 'title', title })
                        result = { content: [{ type: 'text', text: JSON.stringify({ title }) }] }
                    } else {
                        if (workflow?.dayOutline.length && !pendingDates().length && !readOnlyTools.has(call.function.name)) throw new Error('所有日期已核实，请提交审阅，不再添加安排')
                        if (workflow && !readOnlyTools.has(call.function.name) && typeof args.dayId === 'string' && typeof args.tripId === 'string' && pendingDates()[0]) {
                            const saved = await detail(args.tripId)
                            if (saved.days?.find((day: { id: string }) => day.id === args.dayId)?.date !== pendingDates()[0]) throw new Error('请先完成当前日期，再操作下一天')
                        }
                        invoked = true
                        result = await bridge.call(call.function.name, args, signal)
                    }
                } catch (error) {
                    console.error("[ai-tool]", available.has(call.function.name) ? call.function.name : "unavailable-tool", error instanceof Error ? error.name : "UnknownError")
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
            return { done: false }
        })
        .addEdge(START, 'assess')
        .addEdge('assess', 'model')
        .addConditionalEdges('model', state => state.done ? END : 'tools')
        .addEdge('tools', 'model')
        .compile()
        await graph.invoke({ done: false, calls: [] }, { recursionLimit: 40, signal })
    } finally { await bridge.close() }
}
