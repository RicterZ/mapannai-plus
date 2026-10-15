import { AsyncLocalStorage } from 'node:async_hooks'

type Trace = { secrets: string[]; write: (kind: string, payload: string) => void }
const context = new AsyncLocalStorage<Trace>()
export function agentTraceEnabled(): boolean {
    return process.env.AGENT_TRACE_ENABLED === 'true' || (process.env.AGENT_TRACE_ENABLED === undefined && process.env.NODE_ENV !== 'production')
}
export function withAgentTrace<T>(trace: Trace, run: () => T): T { return context.run(trace, run) }
export function traceAgent(kind: string, value: unknown) {
    const trace = context.getStore()
    if (!trace) return
    const text = JSON.stringify(value, (key, item) => {
        if (/^(apiKey|authorization|cookie|token|secret|password)$/i.test(key)) return '[REDACTED]'
        if (typeof item !== 'string') return item
        for (const secret of trace.secrets.filter(Boolean)) item = item.split(secret).join('[REDACTED]')
        return item.replace(/https?:[^\s"<>]*[?][^\s"<>]*(?:signature|credential|token|key)[^\s"<>]*/gi, '[REDACTED_URL]')
    })
    try { trace.write(kind, text) } catch { console.warn('[agent-trace]', 'write-failed') }
}
