export interface MapCardAnchor { id: string; x: number; y: number }
export interface MapCardPlacement extends MapCardAnchor { left: number; top: number }
export const itineraryCardSize = { width: 208, height: 64 }

// Keep cards inside the free map viewport; hide excess rather than overlap them.
export function layoutItineraryCards(anchors: MapCardAnchor[], bounds: { left: number; top: number; right: number; bottom: number }): MapCardPlacement[] {
    const { width, height } = itineraryCardSize
    const placed: MapCardPlacement[] = []
    for (const anchor of anchors) {
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < bounds.left - 100 || anchor.x > bounds.right + 100 || anchor.y < bounds.top - 100 || anchor.y > bounds.bottom + 100) continue
        const candidates = [
            { left: anchor.x + 28, top: anchor.y - height / 2 },
            { left: anchor.x - width - 28, top: anchor.y - height / 2 },
            { left: anchor.x - width / 2, top: anchor.y - height - 28 },
            { left: anchor.x - width / 2, top: anchor.y + 28 },
        ].map(p => ({ left: Math.max(bounds.left, Math.min(bounds.right - width, p.left)), top: Math.max(bounds.top, Math.min(bounds.bottom - height, p.top)) }))
        // Search the free map area as well as nearby positions when days share a base.
        for (let top = bounds.top; top + height <= bounds.bottom; top += height + 12) {
            for (let left = bounds.left; left + width <= bounds.right; left += width + 16) candidates.push({ left, top })
            candidates.push({ left: bounds.right - width, top })
        }
        candidates.sort((a, b) => Math.hypot(a.left + width / 2 - anchor.x, a.top + height / 2 - anchor.y) - Math.hypot(b.left + width / 2 - anchor.x, b.top + height / 2 - anchor.y))
        const candidate = candidates.find(p => p.left >= bounds.left && p.top >= bounds.top && p.left + width <= bounds.right && p.top + height <= bounds.bottom
            && !anchors.some(point => point.x > p.left - 14 && point.x < p.left + width + 14 && point.y > p.top - 14 && point.y < p.top + height + 14)
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
