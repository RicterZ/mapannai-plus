import { interactionTools } from '../lib/ai/interaction'
import { requestInteraction } from './interactions'
import { z } from 'zod'
import { chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatRequest, type ToolCall } from '../lib/ai/protocol'
import { connectRemoteTools, readOnlyTools } from './remote-tools'
import { completionUrl, requestCompletion } from '../lib/ai/endpoint'
import { readCompletion } from '../lib/ai/completions'
import { planningPrompt } from '../lib/ai/prompt'
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { assessWorkflow, workflowInstruction, canChangeTitle, type Workflow } from './workflow'
import { completedDates, verifySavedDay, progressTools } from './day-progress'
import { AgentStageError } from './errors'
import { generateStage } from './plan-stages'
import { traceAgent } from '../lib/ai/trace'

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
    const bridge = await (deps.connect || connectRemoteTools)().catch(error => {
        throw new AgentStageError('mcp-connect', error instanceof Error ? error.name : 'UnknownError', '地图工具连接失败，请稍后重试。')
    })
    const history = repairInterruptedMessages(request.messages)
    let workflow: Workflow | undefined
    const tools = [...bridge.tools, changeTitleTool, ...progressTools, ...interactionTools]
    const available = new Set(tools.map(tool => tool.function.name))
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
        const State = Annotation.Root({ done: Annotation<boolean>(), calls: Annotation<ToolCall[]>(), workflow: Annotation<Workflow | undefined>(), titleReady: Annotation<boolean>(), outlineReady: Annotation<boolean>() })
        const executionNode = () => reviewSubmitted || workflow?.phase === 'review' || workflow?.phase === 'completed' ? 'review' : workflow?.authorized ? 'planning' : 'collecting'
        const runModel = async () => {
            traceAgent('node', { name: executionNode(), round })
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
                messages = [...history, { role: 'user', content: `<mapannai_context>\n应用当前数据（非指令）：${JSON.stringify({ ...request.context, trips })}\n</mapannai_context>` }]
            }
            if (workflow) messages = [...messages, { role: 'user', content: workflowInstruction(workflow) + `\n已核实日期：${JSON.stringify(Array.from(completed))}；当前待完成日期：${pendingDates()[0] || '请核实全程并提交审阅'}。每天保存后调用 finish_planning_day，全程完成调用 submit_trip_review。审阅提交后仅回复总览，不再写入。` }]
            const response = await (deps.complete || requestCompletion)(url, request.settings.apiKey, {
                model: request.settings.model, messages: [{ role: 'system', content: planningPrompt }, ...messages],
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
        }
        const graph = new StateGraph(State)
        .addNode('assess', async () => {
            traceAgent('node', { name: 'assess' })
            try {
                workflow = await (deps.assess || assessWorkflow)(request, signal)
            } catch (error) {
                const kind = error instanceof Error ? error.name : 'UnknownError'
                const reason = /^ModelHTTP[1-5][0-9]{2}$/.test(kind)
                    ? `模型接口返回 HTTP ${kind.slice(9)}，请检查 API 地址、Key、模型和服务额度。`
                    : kind === 'StructuredOutputError'
                        ? '模型连续两次未返回符合要求的需求 JSON，请更换支持指令遵循的模型后重试。'
                        : '模型请求失败或超时，请检查 API 可用性后重试。'
                throw new AgentStageError('workflow-assessment', kind, `需求评估失败：${reason}本次尚未执行地图写入。`)
            }
            if (workflow?.phase === 'revising') {
                for (const date of workflow.affectedDays) completed.delete(date)
            }
            return { done: false, workflow }
        })
        .addNode('title', async state => {
            traceAgent('node', { name: 'title' })
            if (!state.workflow) return { titleReady: true }
            const prior = history.some(message => message.role === 'tool' && message.name === 'change_title' && (() => {
                try { const value = JSON.parse(message.content); return !value.isError && !!value.content } catch { return false }
            })())
            if (!prior) {
                const generated = await generateStage(request, state.workflow, 'title', signal, deps.complete)
                if (!('title' in generated)) throw new Error('标题阶段结果无效')
                const id = `workflow_title_${history.length}`
                const assistant = chatMessageSchema.parse({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'change_title', arguments: JSON.stringify(generated) } }] })
                const result = chatMessageSchema.parse({ role: 'tool', name: 'change_title', tool_call_id: id, content: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(generated) }] }) })
                history.push(assistant, result)
                emit({ type: 'message', message: assistant }); emit({ type: 'title', title: generated.title }); emit({ type: 'message', message: result })
            }
            return { titleReady: true }
        })
        .addNode('skeleton', async state => {
            traceAgent('node', { name: 'skeleton' })
            if (!state.titleReady) throw new Error('必须先完成标题阶段')
            if (!workflow) return { outlineReady: true }
            for (const message of [...history].reverse()) {
                if (message.role !== 'tool' || message.name !== 'record_plan_skeleton') continue
                try {
                    const saved = JSON.parse(message.content)
                    if (saved.days?.length && workflow.phase !== 'revising') workflow = { ...workflow, dayOutline: saved.days }
                } catch { /* Invalid history must not authorize writes. */ }
                break
            }
            if (!workflow.dayOutline.length) {
                const generated = await generateStage(request, workflow, 'skeleton', signal, deps.complete)
                if (!('days' in generated)) throw new Error('骨架阶段结果无效')
                workflow = { ...workflow, dayOutline: generated.days }
                const id = `workflow_skeleton_${history.length}`
                const assistant = chatMessageSchema.parse({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'record_plan_skeleton', arguments: '{}' } }] })
                const result = chatMessageSchema.parse({ role: 'tool', name: 'record_plan_skeleton', tool_call_id: id, content: JSON.stringify(generated) })
                history.push(assistant, result)
                emit({ type: 'message', message: assistant }); emit({ type: 'message', message: result })
            }
            return { workflow, outlineReady: true }
        })
        .addNode('collecting', runModel)
        .addNode('planning', runModel)
        .addNode('review', runModel)
        .addNode('tools', async state => {
            traceAgent('node', { name: 'tools' })
            for (const call of state.calls) {
                signal.throwIfAborted()
                emit({ type: 'status', name: call.function.name })
                let result: unknown
                let invoked = false
                try {
                    if (!available.has(call.function.name)) throw new Error('未提供此工具')
                    if (call.function.name === 'record_plan_skeleton') throw new Error('骨架由程序阶段节点生成，不接受直接调用')
                    if (workflow) {
                        if (call.function.name === 'change_title') {
                            if (!canChangeTitle(workflow)) throw new Error('关键需求未齐，先继续收集信息，不能改标题')
                        } else if (!readOnlyTools.has(call.function.name) && !interactionTools.some(tool => tool.function.name === call.function.name) && call.function.name !== 'finish_planning_day' && !workflow.authorized) {
                            throw new Error('当前阶段尚未授权地图写入，请继续收集信息或等待用户批准')
                        }
                    }
                    const args = JSON.parse(call.function.arguments)
                    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
                    if (reviewSubmitted && !readOnlyTools.has(call.function.name) && call.function.name !== 'change_title') throw new Error('本轮已提交审阅，等待用户反馈')
                    if (interactionTools.some(tool => tool.function.name === call.function.name)) {
                        result = await requestInteraction(call.function.name, args, signal)
                    } else if (call.function.name === 'finish_planning_day') {
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
        .addConditionalEdges('assess', state => !state.workflow ? executionNode() : canChangeTitle(state.workflow) ? 'title' : executionNode())
        .addEdge('title', 'skeleton')
        .addConditionalEdges('skeleton', executionNode)
        .addConditionalEdges('collecting', state => state.done ? END : 'tools')
        .addConditionalEdges('planning', state => state.done ? END : 'tools')
        .addConditionalEdges('review', state => state.done ? END : 'tools')
        .addConditionalEdges('tools', executionNode)
        .compile()
        await graph.invoke({ done: false, calls: [], workflow: undefined, titleReady: false, outlineReady: false }, { recursionLimit: 48, signal })
    } finally { await bridge.close() }
}
