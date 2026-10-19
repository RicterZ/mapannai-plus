export interface RouteSettings { enabled: boolean }

// Web route planning is always on; ignore legacy browser opt-out settings.
export function useRouteSettings(): RouteSettings {
    return { enabled: true }
}
