export interface ScreenPoint { x: number; y: number }
export interface PickableRoute { dayId: string; path: ScreenPoint[] }

// Resolve the whole hit region, not whichever transparent overlay happens to be on top.
export function pickRouteDay(point: ScreenPoint, routes: PickableRoute[], selected: string | null): string | null {
    const distances = new Map<string, number>()
    for (const route of routes) {
        let distance = Infinity
        for (let i = 1; i < route.path.length; i++) {
            const a = route.path[i - 1], b = route.path[i]
            const dx = b.x - a.x, dy = b.y - a.y
            const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
            distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy))
        }
        if (distance <= 14) distances.set(route.dayId, Math.min(distances.get(route.dayId) ?? Infinity, distance))
    }
    const nearest = Math.min(...Array.from(distances.values()))
    // Nearby but separate lines choose the closest; coincident lines cycle between days.
    const candidates = Array.from(distances).filter(([, distance]) => distance <= nearest + 3).map(([id]) => id).sort()
    if (!candidates.length) return null
    const index = selected ? candidates.indexOf(selected) : -1
    return candidates[(index + 1) % candidates.length]
}
