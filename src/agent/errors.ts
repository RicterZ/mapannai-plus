export class AgentStageError extends Error {
    constructor(public readonly stage: string, public readonly kind: string, message: string) { super(message); this.name = 'AgentStageError' }
}
/** Known gate or model-correctable failure; its message is safe to return to the model. */
export class WorkflowBlocked extends Error {}
export function agentErrorMessage(error: unknown): string {
    if (error instanceof AgentStageError) {
        console.warn('[agent-failure]', error.stage, error.kind)
        return error.message
    }
    console.warn('[agent-failure]', 'execution', error instanceof Error ? error.name : 'UnknownError')
    if (error instanceof Error) {
        // Only our fixed messages are safe to expose; SDK/upstream text stays in private traces.
        const safe = [
            'AI 请求已停止或超时', '无法连接 AI API，请检查地址与网络配置',
            'AI 回复达到长度限制，请缩小本次规划范围', 'AI API 返回空回复',
            'AI 回复中断，请重试；已完成的操作会保留',
            '本轮工具调用较多，已暂停。已完成的操作已保存，可继续发送消息规划剩余部分。',
            '会话记录已较长，请新建会话继续规划；已完成的操作会保留。',
        ]
        if (safe.includes(error.message)) return error.message
        if (/^ModelHTTP[1-5][0-9]{2}$/.test(error.name)) return `模型接口返回 HTTP ${error.name.slice(9)}；已保存的数据保留，请查询后继续。`
    }
    return 'Agent 执行失败；已保存的数据会保留，请查询后继续。'
}
