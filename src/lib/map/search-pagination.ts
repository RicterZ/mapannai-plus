export function parseSearchPagination(params: URLSearchParams) {
    const paginated = params.has('page') || params.has('pageSize') || params.has('pageToken')
    const integer = (name: string, fallback: number, max: number) => {
        const raw = params.get(name)
        if (raw === null) return fallback
        if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是整数`)
        const value = Number(raw)
        if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} 必须在 1–${max} 之间`)
        return value
    }
    const page = integer('page', 1, 100)
    const pageSize = integer('pageSize', 20, 25)
    // Legacy callers retain the old default and capped limit behavior.
    const limit = Math.max(1, Math.min(20, parseInt(params.get('limit') || '5') || 5))
    const pageToken = params.get('pageToken') || undefined
    if (pageToken && pageToken.length > 4096) throw new Error('pageToken 无效')
    return { paginated, page, pageSize, pageToken, limit }
}
