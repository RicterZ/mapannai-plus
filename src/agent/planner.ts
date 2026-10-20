import { resolveRevisionDates, validPlanDate, validatePlanDays } from './plan-dates'
import { hasReviewWaiver, reviewState } from './plan-review'
import { interactionTools } from '../lib/ai/interaction'
import { requestInteraction, SuspendForInteraction } from './interactions'
import { z } from 'zod'
import { MAX_AI_HISTORY_MESSAGES, chatMessageSchema, repairInterruptedMessages, type ChatEvent, type ChatRequest, type ToolCall } from '../lib/ai/protocol'
import { connectRemoteTools, readOnlyTools } from './remote-tools'
import { completionUrl, requestCompletion } from '../lib/ai/endpoint'
import { readCompletion } from '../lib/ai/completions'
import { planningPrompt } from '../lib/ai/prompt'
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { assessWorkflow, workflowInstruction, canChangeTitle, type Workflow } from './workflow'
import { completedDates, verifySavedDay, progressTools } from './day-progress'
import { AgentStageError, WorkflowBlocked } from './errors'
import { generateStage } from './plan-stages'
import { traceAgent } from '../lib/ai/trace'

const changeTitleSchema = z.object({ title: z.string().trim().min(1).max(60) }).strict()
const MAX_MODEL_ROUNDS = 64
const MAX_TOOL_ERROR_TEXT = 1000
const toolErrorText = (result: object) => (Array.isArray((result as { content?: unknown }).content) ? (result as { content: unknown }).content as { type: string; text?: string }[] : [])
    .filter(item => item.type === 'text').map(item => item.text || '').join('\n').trim().slice(0, MAX_TOOL_ERROR_TEXT)
const parseJsonText = (result: object, label: string) => {
    const text = (Array.isArray((result as { content?: unknown }).content) ? (result as { content: unknown }).content as { type: string; text?: string }[] : []).filter(item => item.type === 'text').map(item => item.text || '').join('')
    try { return JSON.parse(text) } catch { throw new WorkflowBlocked(`${label}返回的数据不是有效 JSON，无法核实；请先查询当前数据再决定下一步。`) }
}
/** Classify transport failures without echoing upstream text; MCP tool errors arrive as isError results instead. */
const transportFailure = (error: unknown) => {
    const code = typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : undefined
    const message = error instanceof Error ? error.message : ''
    if (code === -32001 || /timed? ?out/i.test(message)) return '地图工具调用超时，结果可能已部分保存。先查询当前数据确认，不要直接重复写入。'
    if (/\b(401|403)\b/.test(message)) return '地图工具鉴权失败（服务配置问题），本次未能执行。不要重试，请向用户报告服务配置异常。'
    if (/\b5\d\d\b/.test(message) || /ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) return '地图服务暂时不可用，结果可能已部分保存。稍后先查询当前数据确认，不要连续重复写入。'
    return '地图工具调用异常，结果可能已部分保存。先查询当前数据再决定下一步，不要重复写入；若持续失败请报告服务异常。'
}
/** Annotation-only edits on existing itineraries (highlight/time/note/transport, day title) keep stops and route order unchanged. */
const isAnnotationEdit = (name: string, raw: string) => {
    let args: Record<string, unknown>
    try { args = JSON.parse(raw) } catch { return false }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return false
    if (name === 'update_trip_day') return Object.keys(args).every(key => ['tripId', 'dayId', 'title'].includes(key))
    return name === 'update_day_chain' && args.markerIds === undefined && args.stopIds === undefined
}
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
    let targetTripId = request.context.tripId
    const tools = [...bridge.tools, changeTitleTool, ...progressTools, ...interactionTools]
    const available = new Set(tools.map(tool => tool.function.name))
    const completed = completedDates(history)
    let draftApproved = reviewState(history).approved
    let reviewSubmitted = false
    // A resumed run ends with the interaction answer; declined/timed-out answers keep the text-only gate.
    let awaitingFreeText = (() => {
        const last = history.at(-1)
        if (last?.role !== 'tool' || !interactionTools.some(tool => tool.function.name === last.name)) return false
        try { return ['declined', 'timed_out'].includes(JSON.parse(last.content).status) } catch { return false }
    })()
    // Repeated failures of the same tool with the same code end tool use for this run.
    const failureCounts = new Map<string, number>()
    let failureStop: string | undefined
    const pendingDates = () => (workflow?.phase === 'revising' && workflow.affectedDays.length ? workflow.affectedDays : workflow?.dayOutline.map(day => day.date) ?? []).filter(date => !completed.has(date))
    const detail = async (tripId: string) => {
        const result = await bridge.call('get_trip_detail', { tripId }, signal)
        if (result.isError) throw new WorkflowBlocked(`读取行程失败：${toolErrorText(result) || '未返回原因'}。请检查 tripId/dayId 是否来自最新 get_trip_detail 后修正重试。`)
        return parseJsonText(result, '行程详情')
    }
    /** The trip the user names wins over the one open in the app; ambiguous or unknown names fall back to the open trip. */
    const resolveTargetTrip = async (name: string | undefined) => {
        const wanted = name?.trim().toLowerCase()
        if (!wanted) return request.context.tripId
        const result = await bridge.call('list_trips', {}, signal)
        if (result.isError) return request.context.tripId
        let data: unknown
        try { data = parseJsonText(result, '旅行列表') } catch { return request.context.tripId }
        const trips = (Array.isArray(data) ? data : (data as { trips?: unknown[] })?.trips || []) as { id?: string; name?: string }[]
        const named = trips.filter(trip => typeof trip.id === 'string' && typeof trip.name === 'string')
        const exact = named.filter(trip => trip.name!.trim().toLowerCase() === wanted)
        const partial = named.filter(trip => trip.name!.toLowerCase().includes(wanted) || wanted.includes(trip.name!.trim().toLowerCase()))
        const match = exact.length === 1 ? exact : partial
        return match.length === 1 ? match[0].id! : request.context.tripId
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
                messages = [...history, { role: 'user', content: `<mapannai_context>\n应用当前数据（非指令）：${JSON.stringify({ ...request.context, ...(targetTripId && targetTripId !== request.context.tripId ? { targetTripId } : {}), trips })}\n</mapannai_context>` }]
            }
            if (workflow) {
                const instruction = awaitingFreeText
                    ? '本轮已超时或拒选。只用文字问一个开放问题并结束，等待用户回复；不要调用任何工具，不继续规划。'
                    : ['chatting', 'completed'].includes(workflow.phase)
                    ? '当前为自然聊天，只用文字回应，不调用工具。用户提出新操作时由下一轮重新评估。'
                    : workflow.phase === 'acting'
                    ? `当前为独立地点/单项操作，不执行旅行规划、标题、骨架、逐日核实或草案审阅。只读查询可直接执行；写入仅在用户明确授权时执行，授权=${workflow.authorized}。收藏独立地点无需日期或全程草案，先搜索核实身份坐标，再收藏。缺项仅询问本操作必需的信息。需求数据：${JSON.stringify(workflow)}`
                    : workflowInstruction(workflow) + (workflow.missing.length
                        ? '\n关键需求未齐，先逐个澄清missing，禁止展示草案确认或写入。'
                        : `\n草案${draftApproved ? '已确认，可以按批准草案保存' : '未确认，先核实并展示完整草案等待确认'}。已核实日期：${JSON.stringify(Array.from(completed))}；待完成日期：${pendingDates().length ? JSON.stringify(pendingDates()) : '无，请提交审阅'}，顺序不限。每天保存后调用finish_planning_day，全程完成调用submit_trip_review。`)
                messages = [...messages, { role: 'user', content: `<agent_instruction>\n${instruction}\n</agent_instruction>` }]
            }
            if (failureStop) messages = [...messages, { role: 'user', content: `<agent_instruction>\n工具连续失败，程序已停止本轮工具调用：${failureStop}\n现在不要调用任何工具，也不要复述计划或再说“接下来去做”。用一两句话如实告诉用户哪一步没完成、原因，以及需要用户做什么，然后结束本轮。\n</agent_instruction>` }]
            const response = await (deps.complete || requestCompletion)(url, request.settings.apiKey, {
                model: request.settings.model, messages: [{ role: 'system', content: planningPrompt }, ...messages],
                tools, tool_choice: failureStop || awaitingFreeText || workflow?.phase === 'chatting' || workflow?.phase === 'completed' ? 'none' : 'auto', stream: true,
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
            const duplicated = (assistant.tool_calls || []).some(call => ids.size === ids.add(call.id).size)
            if (duplicated) {
                // Rename IDs so every tool reply pairs uniquely, then reject the whole batch unexecuted.
                const renamed = { ...assistant, tool_calls: assistant.tool_calls!.map((call, index) => ({ ...call, id: `${call.id}_${index}` })) }
                history.push(renamed)
                emit({ type: 'message', message: renamed })
                for (const call of renamed.tool_calls) {
                    const message = chatMessageSchema.parse({ role: 'tool', name: call.function.name, tool_call_id: call.id, content: JSON.stringify({ isError: true, code: 'WORKFLOW_BLOCKED', executed: false, content: [{ type: 'text', text: '本批工具调用 ID 重复，未执行任何操作。请为每个调用使用唯一 ID 后重新发出。' }] }) })
                    history.push(message); emit({ type: 'message', message })
                }
                return { done: false, calls: [] }
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
            targetTripId = await resolveTargetTrip(workflow?.targetTripName)
            // Existing trip dates are authoritative, including across-year revisions.
            if (workflow?.phase === 'revising' && targetTripId) {
                const saved = await detail(targetTripId)
                if (saved.days?.length && saved.days.every((day: {date:string}) => validPlanDate(day.date))) {
                    const savedDates: string[] = saved.days.map((day: {date:string}) => day.date).sort()
                    const { dates, added, unknown } = resolveRevisionDates(savedDates, workflow.affectedDays, workflow.addedDays)
                    const outline = [...saved.days.map((day: {date:string;title?:string}) => ({ date: day.date, theme: day.title || '已有安排', constraints: '' })), ...added.map(date => ({ date, theme: '新增日期', constraints: '旅行中尚无此日期：先用 add_day_to_trip（带当天名字）添加，再安排地点与路线' }))]
                        .sort((a, b) => a.date.localeCompare(b.date))
                    workflow = { ...workflow, affectedDays: dates, facts: { ...workflow.facts, dates: `${outline[0].date} ~ ${outline[outline.length - 1].date}` }, dayOutline: outline }
                    if (unknown.length) {
                        workflow = { ...workflow, phase: 'collecting', authorized: false, missing: Array.from(new Set([...workflow.missing, `要修改的日期“${unknown.join('、')}”无法对应当前旅行（${savedDates[0]} ~ ${savedDates[savedDates.length - 1]}）中的某一天，请向用户确认具体日期，或确认是否要新增这一天`])) }
                        draftApproved = false
                    }
                }
            }
            if (workflow && ['outline','planning','revising'].includes(workflow.phase)) {
                if (!workflow.facts.dates.trim() && targetTripId && workflow.phase === 'revising') {
                    const saved = await detail(targetTripId)
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
            if (workflow?.phase === 'revising') {
                for (const date of workflow.affectedDays) completed.delete(date)
            }
            if (workflow && workflow.phase !== 'acting') {
                // Itinerary writes are authorized only by draft approval or an explicit waiver quote; quote-based authorization applies to acting only.
                const finished = reviewState(history).completed
                if (finished && ['planning', 'revising'].includes(workflow.phase)) draftApproved = false
                if (!workflow.missing.length && ['planning', 'revising'].includes(workflow.phase) && hasReviewWaiver(history, workflow.skipReviewQuote)) draftApproved = true
                const writable = draftApproved && !workflow.missing.length && ['outline', 'planning', 'revising'].includes(workflow.phase)
                workflow = { ...workflow, phase: writable && workflow.phase === 'outline' ? 'planning' : workflow.phase, authorized: writable }
            }
            if (workflow?.missing.length && workflow.phase !== 'acting') {
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
                    if (workflow?.phase === 'acting' && !readOnlyTools.has(call.function.name) && !['create_marker', 'update_marker', 'ask_choice', 'ask_datetime'].includes(call.function.name) && !isAnnotationEdit(call.function.name, call.function.arguments)) throw new WorkflowBlocked('当前是独立地点操作，未执行。允许：地点收藏/编辑；update_day_chain仅修改已有访问/交通的重点、时间、时长、车次、备注（不带markerIds）；update_trip_day仅改标题。增删地点、调整路线顺序或新建/删除路线属于修改行程，需要用户说明要改哪天后走修改草案确认，然后结束本轮。')
                    if (workflow?.missing.length && (call.function.name === 'preview_itinerary' || (!readOnlyTools.has(call.function.name) && !['ask_choice', 'ask_datetime'].includes(call.function.name)))) {
                        throw new WorkflowBlocked(`关键需求未齐，未执行本次操作。先逐个向用户澄清：${workflow.missing.join('；')}。不要重试保存，也不要展示草案确认；收到回答后重新评估并展示完整草案。`)
                    }
                    if (workflow?.phase === 'chatting' || workflow?.phase === 'completed') throw new WorkflowBlocked('自然聊天状态不执行地图工具')
                    if (!draftApproved && !readOnlyTools.has(call.function.name) && !interactionTools.some(tool => tool.function.name === call.function.name) && !['change_title','finish_planning_day','submit_trip_review','record_plan_skeleton'].includes(call.function.name) && workflow && workflow.phase !== 'acting') throw new WorkflowBlocked('尚未确认完整草案，禁止写入。先调用preview_itinerary并等待用户确认。')
                    if (failureStop) throw new WorkflowBlocked('工具连续失败，本轮已停止工具调用。请直接向用户说明失败原因并结束本轮。')
                    if (awaitingFreeText) throw new WorkflowBlocked('用户拒选或超时，请仅文字询问并等待回复')
                    if (!available.has(call.function.name)) throw new WorkflowBlocked('未提供此工具')
                    if (call.function.name === 'record_plan_skeleton') throw new WorkflowBlocked('骨架由程序阶段节点生成，不接受直接调用')
                    if (workflow) {
                        if (call.function.name === 'change_title') {
                            if (!canChangeTitle(workflow)) throw new WorkflowBlocked('关键需求未齐，先继续收集信息，不能改标题')
                        } else if (!readOnlyTools.has(call.function.name) && !interactionTools.some(tool => tool.function.name === call.function.name) && call.function.name !== 'finish_planning_day' && !workflow.authorized) {
                            throw new WorkflowBlocked(workflow.phase === 'acting'
                                ? '用户尚未明确授权本次地点写入，未执行。不要重试；用一句话请用户确认要收藏/修改的具体地点，然后结束本轮等待回复。'
                                : '当前阶段尚未授权地图写入，未执行本次操作。不要重试保存；先澄清需求，再展示完整草案等待用户批准。')
                        }
                    }
                    let args: Record<string, unknown>
                    try { args = JSON.parse(call.function.arguments) } catch { throw new WorkflowBlocked('工具参数不是有效JSON。请修正参数格式后重试；本次未执行。') }
                    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new WorkflowBlocked('工具参数必须是对象')
                    if (reviewSubmitted && !readOnlyTools.has(call.function.name) && call.function.name !== 'change_title') throw new WorkflowBlocked('本轮已提交审阅，等待用户反馈')
                    if (interactionTools.some(tool => tool.function.name === call.function.name)) {
                        result = await requestInteraction(call.function.name, args, signal)
                        if (call.function.name === 'preview_itinerary') draftApproved = (result as {status?:string;selection?:{action?:string}}).status === 'selected' && (result as {selection?:{action?:string}}).selection?.action === 'continue'
                        if (call.function.name === 'preview_itinerary' && draftApproved && workflow && workflow.missing.length === 0) workflow = { ...workflow, phase: workflow.phase === 'revising' ? 'revising' : 'planning', authorized: true }
                        if (['declined', 'timed_out'].includes((result as { status?: string }).status || '')) awaitingFreeText = true
                    } else if (call.function.name === 'finish_planning_day') {
                        const { tripId, dayId } = z.object({ tripId: z.string(), dayId: z.string() }).strict().parse(args)
                        const saved = await detail(tripId)
                        let verified: ReturnType<typeof verifySavedDay>
                        try { verified = verifySavedDay(saved, dayId, pendingDates()) } catch (error) { throw new WorkflowBlocked(error instanceof Error ? error.message : '当天核实失败') }
                        completed.add(verified.date)
                        result = verified
                    } else if (call.function.name === 'submit_trip_review') {
                        const { tripId } = z.object({ tripId: z.string() }).strict().parse(args)
                        if (pendingDates().length) throw new WorkflowBlocked('尚有日期未核实完成')
                        const saved = await detail(tripId)
                        if (!saved.days?.length) throw new WorkflowBlocked('旅行没有日期')
                        for (const day of saved.days) {
                            try { verifySavedDay(saved, day.id) } catch (error) { throw new WorkflowBlocked(`${day.date}核实失败：${error instanceof Error ? error.message : '安排无效'}`) }
                        }
                        const markersResult = await bridge.call('list_markers', {}, signal)
                        if (markersResult.isError) throw new WorkflowBlocked(`无法读取地点名称，不能生成概览：${toolErrorText(markersResult) || '未返回原因'}`)
                        const markerData = parseJsonText(markersResult, '地点列表')
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
                        if (workflow?.phase !== 'acting' && workflow?.dayOutline.length && !pendingDates().length && !readOnlyTools.has(call.function.name)) throw new WorkflowBlocked('所有日期已核实，请提交审阅，不再添加安排')
                        if (workflow && workflow.phase !== 'acting' && call.function.name !== 'update_trip_day' && !readOnlyTools.has(call.function.name) && typeof args.dayId === 'string' && typeof args.tripId === 'string' && pendingDates().length) {
                            const saved = await detail(args.tripId)
                            const date = saved.days?.find((day: { id: string }) => day.id === args.dayId)?.date
                            if (!date || !pendingDates().includes(date)) throw new WorkflowBlocked(`该日期不在本次待完成范围内，未执行。可操作的日期：${pendingDates().join('、')}；已核实的日期需要修改时请先告诉用户。`)
                        }
                        invoked = true
                        result = await bridge.call(call.function.name, args, signal)
                    }
                } catch (error) {
                    if (error instanceof SuspendForInteraction) { error.callId = call.id; throw error }
                    console.error("[ai-tool]", available.has(call.function.name) ? call.function.name : "unavailable-tool", error instanceof Error ? error.name : "UnknownError")
                    if (signal.aborted) throw new Error('请求已停止；正在执行的工具可能已保存数据，请查询后继续')
                    const validation = error instanceof z.ZodError
                    const code = error instanceof WorkflowBlocked ? 'WORKFLOW_BLOCKED' : validation ? 'INVALID_ARGUMENTS' : invoked ? 'TOOL_EXECUTION_FAILED' : 'INTERNAL_ERROR'
                    const reason = error instanceof WorkflowBlocked ? error.message : validation ? `参数校验失败：${error.issues.map(issue => `${issue.path.join('.') || '参数'}: ${issue.code}（${issue.message}）`).join('；')}。请按工具schema修正后重试。` : invoked ? transportFailure(error) : '内部执行异常，本次调用未进入地图工具。不要重复相同调用，请向用户报告问题。'
                    traceAgent('tool-failure', { tool: available.has(call.function.name) ? call.function.name : 'unavailable-tool', code, invoked, errorType: error instanceof Error ? error.name : 'UnknownError', reason })
                    result = { isError: true, code, executed: invoked ? 'unknown' : false, content: [{ type: 'text', text: reason }] }                } finally {
                    // A tool can write partially and then fail; refresh even in that case.
                    if (invoked && !readOnlyTools.has(call.function.name)) emit({ type: 'changed' })
                }
                if (result && typeof result === 'object' && (result as { isError?: unknown }).isError === true) {
                    const code = (result as { code?: string }).code || 'TOOL_ERROR'
                    const key = `${call.function.name}:${code}`
                    const count = (failureCounts.get(key) || 0) + 1
                    failureCounts.set(key, count)
                    if (count >= 2 && !failureStop) failureStop = `${call.function.name} 第${count}次失败（${code}）：${toolErrorText(result) || '未返回原因'}`
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
