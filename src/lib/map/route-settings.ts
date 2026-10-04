import { useSyncExternalStore } from 'react'

export interface RouteSettings { enabled: boolean }
const key = 'mapannai_route_settings'
const fallback = '{"enabled":false}'

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
        return { enabled: parsed.enabled === true }
    } catch { return { enabled: false } }
}
export function setRouteSettings(settings: RouteSettings): void {
    localStorage.setItem(key, JSON.stringify(settings))
    window.dispatchEvent(new Event('mapannai:route-settings'))
}
