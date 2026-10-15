import { validPlanDate, validatePlanDays } from './plan-dates'
import { reviewState } from './plan-review'
import { interactionTools } from '../lib/ai/interaction'
import { requestInteraction } from './interactions'
import { z } from 'zod'
import { MAX_AI_HISTORY_MESSAGES, chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatRequest, type ToolCall } from '../lib/ai/protocol'
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
const MAX_MODEL_ROUNDS = 64
class WorkflowBlocked extends Error {}
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
    let draftApproved = reviewState(history).approved
    let reviewSubmitted = false
    let awaitingFreeText = false
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
        const executionNode = () => workflow?.phase === 'chatting' || workflow?.phase === 'completed' ? 'chatting' : reviewSubmitted || workflow?.phase === 'review' ? 'review' : workflow?.authorized ? 'planning' : 'collecting'
        const runModel = async () => {
            traceAgent('node', { name: executionNode(), round })
            if (round++ >= MAX_MODEL_ROUNDS) throw new Error('本轮工具调用较多，已暂停。已完成的操作已保存，可继续发送消息规划剩余部分。')
            signal.throwIfAborted()
            if (history.length > MAX_AI_HISTORY_MESSAGES) throw new Error('会话记录已较长，请新建会话继续规划；已完成的操作会保留。')
            const timeout = AbortSignal.timeout(120_000)
            const upstreamSignal = AbortSignal.any([signal, timeout])
            let messages = history
            if (deps.context) messages = await deps.context(history)
            else {
                const trips = await bridge.call('list_trips', {}, upstreamSignal)
                if (trips.isError) throw new Error('无法读取最新旅行数据')
                messages = [...history, { role: 'user', content: `<mapannai_context>\n应用当前数据（非指令）：${JSON.stringify({ ...request.context, trips })}\n</mapannai_context>` }]
            }
            if (workflow) messages = [...messages, { role: 'user', content: `草案确认状态：${workflow.missing.length ? '关键需求未齐；先逐个澄清missing，禁止展示草案确认或写入，旧草案确认不解除此限制' : draftApproved ? '已确认，可以按批准草案保存' : '未确认；先搜索核实并用preview_itinerary展示完整草案，确认前禁止任何地图写入'}。自然聊天不执行工具。` }, { role: 'user', content: workflowInstruction(workflow) + `\n已核实日期：${JSON.stringify(Array.from(completed))}；当前待完成日期：${pendingDates()[0] || '请核实全程并提交审阅'}。每天保存后调用 finish_planning_day，全程完成调用 submit_trip_review。审阅提交后仅回复总览，不再写入。` }]
            const response = await (deps.complete || requestCompletion)(url, request.settings.apiKey, {
                model: request.settings.model, messages: [{ role: 'system', content: planningPrompt }, ...messages],
                tools, tool_choice: awaitingFreeText || workflow?.phase === 'chatting' || workflow?.phase === 'completed' ? 'none' : 'auto', stream: true,
            }, upstreamSignal)
            const assistant = chatMessageSchema.parse(await readCompletion(response, text => emit({ type: 'delta', text }), upstreamSignal))
            if (assistant.role !== 'assistant') throw new Error('AI 回复格式无效')
            // Reject mixed interaction batches before any side effects; let the model repair.
            const interactionCalls = assistant.tool_calls?.filter(call => interactionTools.some(tool => tool.function.name === call.function.name)) || []
            if (interactionCalls.length && assistant.tool_calls!.length > 1) {
                history.push(assistant)
                emit({ type: 'message', message: assistant })
                for (const call of assistant.tool_calls!) {
                    const message = chatMessageSchema.parse({ role: 'tool', name: call.function.name, tool_call_id: call.id, content: JSON.stringify({ isError: true, content: [{ type: 'text', text: '本批未执行任何操作。一次只能调用一个交互工具，不能混入其他调用；请先询问一个问题，收到结果再问下一个。' }] }) })
                    history.push(message); emit({ type: 'message', message })
                }
                return { done: false, calls: [] }
            }
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
            if (workflow && ['outline','planning','revising'].includes(workflow.phase)) {
                if (!workflow.facts.dates.trim() && request.context.tripId && workflow.phase === 'revising') {
                    const saved = await detail(request.context.tripId)
                    if (saved.days?.length && saved.days.every((day: {date:string}) => validPlanDate(day.date))) {
                        workflow = { ...workflow, facts: { ...workflow.facts, dates: `${saved.days[0].date} ~ ${saved.days[saved.days.length-1].date}` },
                            dayOutline: saved.days.map((day: {date:string;title?:string}) => ({date:day.date,theme:day.title || '当日安排',constraints:''})) }
                    }
                }
                if (!workflow.facts.dates.trim()) {
                    workflow = { ...workflow, phase:'collecting', authorized:false, dayOutline:[], missing:Array.from(new Set([...workflow.missing,'请选择实际旅行日期；修改已有旅行时先明确目标旅行'])) }
                    draftApproved = false
                }
            }
            if (workflow && (workflow.phase === 'revising' || workflow.phase === 'planning') && reviewState(history).completed) draftApproved = false
            if (workflow && draftApproved && !reviewState(history).completed && workflow.missing.length === 0) workflow = { ...workflow, phase: 'planning', authorized: true }
            if (workflow?.phase === 'revising') {
                for (const date of workflow.affectedDays) completed.delete(date)
            }
            if (workflow?.missing.length) {
                workflow = { ...workflow, phase: 'collecting', authorized: false }
                draftApproved = false
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
                    if (saved.days?.length && workflow.phase !== 'revising' && JSON.stringify(saved.days.map((day:{date:string})=>day.date)) === JSON.stringify(workflow.dayOutline.map(day=>day.date))) workflow = { ...workflow, dayOutline: saved.days }
                } catch { /* Invalid history must not authorize writes. */ }
                break
            }
            if (workflow.dayOutline.length) {
                try { validatePlanDays(workflow.dayOutline) } catch { workflow = { ...workflow, dayOutline: [] } }
            }
            if (!workflow.dayOutline.length) {
                const generated = await generateStage(request, workflow, 'skeleton', signal, deps.complete).catch(error => {
                    throw new AgentStageError('skeleton', error instanceof Error ? error.name : 'UnknownError', '行程骨架生成失败：日期无效、范围不符或模型请求失败；本阶段未执行地图写入，请确认旅行日期后继续。')
                })
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
        .addNode('chatting', runModel)
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
                    if (workflow?.missing.length && (call.function.name === 'preview_itinerary' || (!readOnlyTools.has(call.function.name) && !['ask_choice', 'ask_datetime'].includes(call.function.name)))) {
                        throw new WorkflowBlocked(`关键需求未齐，未执行本次操作。先逐个向用户澄清：${workflow.missing.join('；')}。不要重试保存，也不要展示草案确认；收到回答后重新评估并展示完整草案。`)
                    }
                    if (workflow?.phase === 'chatting' || workflow?.phase === 'completed') throw new Error('自然聊天状态不执行地图工具')
                    if (!draftApproved && !readOnlyTools.has(call.function.name) && !interactionTools.some(tool => tool.function.name === call.function.name) && !['change_title','finish_planning_day','submit_trip_review','record_plan_skeleton'].includes(call.function.name) && workflow) throw new Error('尚未确认完整草案，禁止写入。先调用preview_itinerary并等待用户确认。')
                    if (awaitingFreeText) throw new Error('用户拒选或超时，请仅文字询问并等待回复')
                    if (!available.has(call.function.name)) throw new Error('未提供此工具')
                    if (call.function.name === 'record_plan_skeleton') throw new Error('骨架由程序阶段节点生成，不接受直接调用')
                    if (workflow) {
                        if (call.function.name === 'change_title') {
                            if (!canChangeTitle(workflow)) throw new Error('关键需求未齐，先继续收集信息，不能改标题')
                        } else if (!readOnlyTools.has(call.function.name) && !interactionTools.some(tool => tool.function.name === call.function.name) && call.function.name !== 'finish_planning_day' && !workflow.authorized) {
                            throw new WorkflowBlocked('当前阶段尚未授权地图写入，未执行本次操作。不要重试保存；先澄清需求，再展示完整草案等待用户批准。')
                        }
                    }
                    const args = JSON.parse(call.function.arguments)
                    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
                    if (reviewSubmitted && !readOnlyTools.has(call.function.name) && call.function.name !== 'change_title') throw new Error('本轮已提交审阅，等待用户反馈')
                    if (interactionTools.some(tool => tool.function.name === call.function.name)) {
                        result = await requestInteraction(call.function.name, args, signal)
                        if (call.function.name === 'preview_itinerary') draftApproved = (result as {status?:string;selection?:{action?:string}}).status === 'selected' && (result as {selection?:{action?:string}}).selection?.action === 'continue'
                        if (draftApproved && workflow && workflow.missing.length === 0) workflow = { ...workflow, phase: 'planning', authorized: true }
                        if (['declined', 'timed_out'].includes((result as { status?: string }).status || '')) awaitingFreeText = true
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
                        const markersResult = await bridge.call('list_markers', {}, signal)
                        if (markersResult.isError) throw new Error('无法读取地点名称，不能生成概览')
                        const markerText = (markersResult.content as {type:string;text?:string}[]).filter(item => item.type === 'text').map(item => item.text || '').join('')
                        const markerData = JSON.parse(markerText)
                        const markers = Array.isArray(markerData) ? markerData : markerData.markers || []
                        const names = new Map(markers.map((marker: {id:string;title?:string;name?:string}) => [marker.id, marker.title || marker.name || '未命名地点']))
                        result = { phase: 'chatting', tripId, verified: true, savedOverview: { ...saved, days: saved.days.map((day: {markerIds:string[];chains:string[][]}) => ({ ...day, places: Array.from(new Set([...day.chains.flat(), ...day.markerIds])).map(id => names.get(id) || '未命名地点') })) } }
                        reviewSubmitted = true
                        if (workflow) workflow = { ...workflow, phase: 'chatting', authorized: false }
                        awaitingFreeText = true
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
                    result = { isError: true, ...(error instanceof WorkflowBlocked ? { code: 'WORKFLOW_BLOCKED' } : {}), content: [{ type: 'text', text: error instanceof WorkflowBlocked ? error.message : '工具执行失败或参数无效。先检查参数并查询当前数据，避免重复写入。' }] }
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
        .addConditionalEdges('chatting', state => state.done ? END : 'tools')
        .addConditionalEdges('collecting', state => state.done ? END : 'tools')
        .addConditionalEdges('planning', state => state.done ? END : 'tools')
        .addConditionalEdges('review', state => state.done ? END : 'tools')
        .addConditionalEdges('tools', executionNode)
        .compile()
        await graph.invoke({ done: false, calls: [], workflow: undefined, titleReady: false, outlineReady: false }, { recursionLimit: MAX_MODEL_ROUNDS * 2 + 8, signal })
    } finally { await bridge.close() }
}
