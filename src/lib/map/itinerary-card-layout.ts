export interface MapCardAnchor { id: string; x: number; y: number }
export interface MapCardPlacement extends MapCardAnchor { left: number; top: number }
export const itineraryCardSize = { width: 208, height: 40 }

// Intersect the center-to-anchor ray with the card edge, preserving its angle.
export function itineraryLeaderEnd(p: MapCardPlacement): { x: number; y: number } {
    const { width, height } = itineraryCardSize
    const cx = p.left + width / 2, cy = p.top + height / 2
    const dx = p.x - cx, dy = p.y - cy
    const scale = 1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2), 1)
    return { x: cx + dx * scale, y: cy + dy * scale }
}

// Keep cards inside the free map viewport; hide excess rather than overlap them.
export function layoutItineraryCards(anchors: MapCardAnchor[], bounds: { left: number; top: number; right: number; bottom: number }, paths: Array<Array<{ x: number; y: number }>> = []): MapCardPlacement[] {
    const { width, height } = itineraryCardSize
    const placed: MapCardPlacement[] = []
    for (const anchor of anchors) {
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < bounds.left - 100 || anchor.x > bounds.right + 100 || anchor.y < bounds.top - 100 || anchor.y > bounds.bottom + 100) continue
        const candidates = [
            { left: anchor.x + 100, top: anchor.y - height / 2 },
            { left: anchor.x - width - 100, top: anchor.y - height / 2 },
            { left: anchor.x - width / 2, top: anchor.y - height - 100 },
            { left: anchor.x - width / 2, top: anchor.y + 100 },
        ].map(p => ({ left: Math.max(bounds.left, Math.min(bounds.right - width, p.left)), top: Math.max(bounds.top, Math.min(bounds.bottom - height, p.top)) }))
        // Radial candidates let leader angles follow free space, rather than fixed axes.
        for (const radius of [180, 260, 360]) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                candidates.push({ left: anchor.x + Math.cos(angle) * radius - width / 2, top: anchor.y + Math.sin(angle) * radius - height / 2 })
            }
        }
        // Search the free map area as well as nearby positions when days share a base.
        for (let top = bounds.top; top + height <= bounds.bottom; top += height + 12) {
            for (let left = bounds.left; left + width <= bounds.right; left += width + 16) candidates.push({ left, top })
            candidates.push({ left: bounds.right - width, top })
        }
        const score = (p: { left: number; top: number }) => {
            const end = { x: p.left + width / 2, y: p.top + height / 2 }
            const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
            const crossings = placed.filter(other => {
                const target = { x: other.left + width / 2, y: other.top + height / 2 }
                return cross(anchor, end, other) * cross(anchor, end, target) < 0 && cross(other, target, anchor) * cross(other, target, end) < 0
            }).length
            const leader = itineraryLeaderEnd({ ...anchor, ...p })
            const dx = Math.abs(leader.x - anchor.x), dy = Math.abs(leader.y - anchor.y)
            const length = Math.hypot(dx, dy)
            // Prefer visibly diagonal leaders, not the shortest horizontal/vertical slot.
            const axisPenalty = Math.max(0, 0.35 - Math.min(dx, dy) / Math.max(1, length)) * 2000
            return Math.hypot(end.x - anchor.x, end.y - anchor.y) + crossings * 1000 + axisPenalty
        }
        candidates.sort((a, b) => score(a) - score(b))
        const candidate = candidates.find(p => p.left >= bounds.left && p.top >= bounds.top && p.left + width <= bounds.right && p.top + height <= bounds.bottom
            && Math.hypot(Math.max(p.left - anchor.x, 0, anchor.x - p.left - width), Math.max(p.top - anchor.y, 0, anchor.y - p.top - height)) >= 80
            && !anchors.some(point => point.x > p.left - 14 && point.x < p.left + width + 14 && point.y > p.top - 14 && point.y < p.top + height + 14)
            && !paths.some(path => path.slice(1).some((b, i) => {
                const a = path[i]
                let low = 0, high = 1
                for (const [start, delta, min, max] of [[a.x, b.x - a.x, p.left - 12, p.left + width + 12], [a.y, b.y - a.y, p.top - 12, p.top + height + 12]]) {
                    if (!delta) { if (start < min || start > max) return false; continue }
                    const enter = (min - start) / delta, exit = (max - start) / delta
                    low = Math.max(low, Math.min(enter, exit)); high = Math.min(high, Math.max(enter, exit))
                    if (low > high) return false
                }
                return low <= high
            }))
            && !placed.some(other => p.left < other.left + width + 12 && p.left + width + 12 > other.left && p.top < other.top + height + 12 && p.top + height + 12 > other.top))
        if (candidate) placed.push({ ...anchor, ...candidate })
    }
    return placed
}

export function sameItineraryPlacements(previous: MapCardPlacement[], next: MapCardPlacement[]): boolean {
    return previous.length === next.length && previous.every((item, i) => {
        const other = next[i]
        return item.id === other.id && item.x === other.x && item.y === other.y && item.left === other.left && item.top === other.top
    })
}
