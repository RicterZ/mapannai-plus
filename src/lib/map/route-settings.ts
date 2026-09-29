import { useSyncExternalStore } from 'react'

export type RouteMode = 'walking' | 'driving'
export interface RouteSettings { enabled: boolean; mode: RouteMode }
const key = 'mapannai_route_settings'
const fallback = '{"enabled":false,"mode":"walking"}'

function snapshot(): string {
    if (typeof window === 'undefined') return fallback
    return localStorage.getItem(key) || fallback
}
function subscribe(callback: () => void): () => void {
    window.addEventListener('mapannai:route-settings', callback)
    window.addEventListener('storage', callback)
    return () => {
        window.removeEventListener('mapannai:route-settings', callback)
        window.removeEventListener('storage', callback)
    }
}
export function useRouteSettings(): RouteSettings {
    const value = useSyncExternalStore(subscribe, snapshot, () => fallback)
    try {
        const parsed = JSON.parse(value)
        return { enabled: parsed.enabled === true, mode: parsed.mode === 'driving' ? 'driving' : 'walking' }
    } catch { return { enabled: false, mode: 'walking' } }
}
export function setRouteSettings(settings: RouteSettings): void {
    localStorage.setItem(key, JSON.stringify(settings))
    window.dispatchEvent(new Event('mapannai:route-settings'))
}
