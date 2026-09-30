import { create } from 'zustand'

interface RouteProgress {
    total: number
    completed: number
    failed: number
    calculating: boolean
    retryVersion: number
    report: (progress: Pick<RouteProgress, 'total' | 'completed' | 'failed' | 'calculating'>) => void
    retry: () => void
}
export const useRouteProgress = create<RouteProgress>(set => ({
    total: 0, completed: 0, failed: 0, calculating: false, retryVersion: 0,
    report: progress => set(progress),
    retry: () => set(state => ({ retryVersion: state.retryVersion + 1 })),
}))
