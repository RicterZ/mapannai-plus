import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { interactionSchema, validateSelection, type InteractionPrompt } from '../lib/ai/interaction'
import { WorkflowBlocked } from './errors'
const pending = new Map<string, { token: string; input: InteractionPrompt['input']; deadline: number; resolve: (value: unknown) => void }>()
const context = new AsyncLocalStorage<(prompt: InteractionPrompt) => void>()
export const withInteractions = <T>(emit: (prompt: InteractionPrompt) => void, run: () => T) => context.run(emit, run)
export function answerInteraction(id: string, token: string, value: unknown) {
    const item = pending.get(id)
    if (!item || item.token !== token || Date.now() >= item.deadline) return false
    const selected = validateSelection(item.input, value)
    if (item.input.kind === 'ask_choice' && !Array.isArray(selected) && 'action' in selected && selected.action === 'none') {
        item.resolve({ status: 'declined', selection: null, source: 'user', kind: 'ask_choice', summary: '都不选，改用文字说明', instruction: '用户明确拒绝这些选项。现在仅用文字问一个开放问题并结束本轮，等待用户回复；不要再次弹选择卡、默认选择或执行写入。' })
        return true
    }
    item.resolve({ status: 'selected', selection: selected, source: 'user', kind: item.input.kind, summary: item.input.kind === 'ask_choice' ? item.input.options.filter(option => (selected as string[]).includes(option.id)).map(option => option.label).join('、') : JSON.stringify(selected) })
    return true
}
export async function requestInteraction(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const input = interactionSchema.parse({ ...args, kind: name })
    if (input.kind === 'ask_choice' && new Set(input.options.map(option => option.id)).size !== input.options.length) throw new WorkflowBlocked('ask_choice 的选项 id 重复，请为每个选项使用唯一 id 后重试；本次未弹出卡片。')
    const emit = context.getStore()
    if (!emit) return { status: 'unsupported', selection: null, source: 'none' }
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        const id = randomUUID(), token = randomUUID(), deadline = Date.now() + 60_000
        const cleanup = () => { clearTimeout(timer); pending.delete(id); signal.removeEventListener('abort', abort) }
        const finish = (value: unknown) => { cleanup(); resolve(value) }
        const abort = () => { cleanup(); reject(new Error('请求已停止')) }
        const timer = setTimeout(() => finish({ status: 'timed_out', selection: null, source: 'none', instruction: '用户60秒未选择。现在仅用文字问一个开放问题并结束本轮，等待用户回复；不要再次弹卡、默认选择、自行安排或执行写入。' }), 60_000)
        pending.set(id, { token, deadline, input, resolve: finish })
        signal.addEventListener('abort', abort, { once: true })
        emit({ id, token, deadline, input })
    })
}
