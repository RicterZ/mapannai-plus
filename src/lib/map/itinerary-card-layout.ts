export interface MapCardAnchor { id: string; x: number; y: number }
export interface MapCardPlacement extends MapCardAnchor { left: number; top: number }
export const itineraryCardSize = { width: 208, height: 40 }

type Point = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
type Segment = [Point, Point]
interface Candidate { left: number; top: number; end: Point; angle: number; length: number; cost: number }

const LENGTHS = [96, 128, 168, 224, 300]
const ANGLE_STEPS = 32
const MIN_ANCHOR_GAP = 80
const CARD_GAP = 12
const ROUTE_PAD = 8
const ANCHOR_PAD = 14

// Intersect the center-to-anchor ray with the card edge, preserving its angle.
export function itineraryLeaderEnd(p: MapCardPlacement): Point {
    const { width, height } = itineraryCardSize
    const cx = p.left + width / 2, cy = p.top + height / 2
    const dx = p.x - cx, dy = p.y - cy
    const scale = 1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2), 1)
    return { x: cx + dx * scale, y: cy + dy * scale }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const degDiff = (a: number, b: number) => Math.abs(wrap(a - b)) * 180 / Math.PI

function cross(a: Point, b: Point, c: Point) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
    return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}
function segmentHitsRect(a: Point, b: Point, r: Bounds) {
    let low = 0, high = 1
    for (const [start, delta, min, max] of [[a.x, b.x - a.x, r.left, r.right], [a.y, b.y - a.y, r.top, r.bottom]]) {
        if (!delta) { if (start < min || start > max) return false; continue }
        const enter = (min - start) / delta, exit = (max - start) / delta
        low = Math.max(low, Math.min(enter, exit)); high = Math.min(high, Math.max(enter, exit))
        if (low > high) return false
    }
    return true
}
function pointSegmentDistance(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const rectOf = (left: number, top: number, pad = 0): Bounds => ({ left: left - pad, top: top - pad, right: left + itineraryCardSize.width + pad, bottom: top + itineraryCardSize.height + pad })
const rectDistance = (r: Bounds, p: Point) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom))

/** Uniform grid over screen-space route segments so candidate checks stay local. */
class SegmentIndex {
    private cells = new Map<string, number[]>()
    readonly segments: Segment[] = []
    constructor(paths: Point[][], view: Bounds, private size = 64) {
        for (const path of paths) {
            let last: Point | undefined
            for (const point of path) {
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
                if (last && Math.hypot(point.x - last.x, point.y - last.y) < 4) continue
                if (last && Math.max(last.x, point.x) >= view.left && Math.min(last.x, point.x) <= view.right && Math.max(last.y, point.y) >= view.top && Math.min(last.y, point.y) <= view.bottom) this.add([last, point])
                last = point
            }
        }
    }
    private add(segment: Segment) {
        const index = this.segments.push(segment) - 1
        const [a, b] = segment
        for (let cx = Math.floor(Math.min(a.x, b.x) / this.size); cx <= Math.floor(Math.max(a.x, b.x) / this.size); cx++) {
            for (let cy = Math.floor(Math.min(a.y, b.y) / this.size); cy <= Math.floor(Math.max(a.y, b.y) / this.size); cy++) {
                const key = `${cx}:${cy}`
                const list = this.cells.get(key)
                if (list) list.push(index); else this.cells.set(key, [index])
            }
        }
    }
    query(r: Bounds): Segment[] {
        const found = new Set<number>()
        for (let cx = Math.floor(r.left / this.size); cx <= Math.floor(r.right / this.size); cx++) {
            for (let cy = Math.floor(r.top / this.size); cy <= Math.floor(r.bottom / this.size); cy++) this.cells.get(`${cx}:${cy}`)?.forEach(i => found.add(i))
        }
        return Array.from(found, i => this.segments[i])
    }
}

/** Macro shape: centroid and principal axis of the whole displayed itinerary. */
function routeShape(points: Point[]) {
    const n = points.length || 1
    const cx = points.reduce((s, p) => s + p.x, 0) / n, cy = points.reduce((s, p) => s + p.y, 0) / n
    let sxx = 0, syy = 0, sxy = 0
    for (const p of points) { sxx += (p.x - cx) ** 2; syy += (p.y - cy) ** 2; sxy += (p.x - cx) * (p.y - cy) }
    const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    return { center: { x: cx, y: cy }, axis: { x: Math.cos(axis), y: Math.sin(axis) }, spread: Math.sqrt((sxx + syy) / n) }
}

/** Outward normal of the local route direction, biased toward diagonals so leaders read as slanted. */
function preferredAngle(anchor: Point, index: SegmentIndex, shape: ReturnType<typeof routeShape>): number {
    let c2 = 0, s2 = 0
    for (const [a, b] of index.query({ left: anchor.x - 56, top: anchor.y - 56, right: anchor.x + 56, bottom: anchor.y + 56 })) {
        const d = pointSegmentDistance(anchor, a, b)
        if (d > 56) continue
        const theta = Math.atan2(b.y - a.y, b.x - a.x), weight = Math.hypot(b.x - a.x, b.y - a.y) / (8 + d)
        c2 += Math.cos(2 * theta) * weight; s2 += Math.sin(2 * theta) * weight
    }
    const outward = { x: anchor.x - shape.center.x, y: anchor.y - shape.center.y }
    const outwardLength = Math.hypot(outward.x, outward.y)
    // Near the centroid, fall back to the side normal of the principal axis that points up.
    const up = shape.axis.x >= 0 ? { x: shape.axis.y, y: -shape.axis.x } : { x: -shape.axis.y, y: shape.axis.x }
    const away = outwardLength > Math.max(24, shape.spread * 0.15) ? Math.atan2(outward.y, outward.x) : Math.atan2(up.y, up.x)
    let angle = away
    if (Math.hypot(c2, s2) > 0.05) {
        const tangent = 0.5 * Math.atan2(s2, c2)
        const normals = [tangent + Math.PI / 2, tangent - Math.PI / 2]
        const normal = degDiff(normals[0], away) <= degDiff(normals[1], away) ? normals[0] : normals[1]
        angle = wrap(normal + wrap(away - normal) * 0.3)
    } else if (outwardLength <= Math.max(24, shape.spread * 0.15)) {
        angle = -Math.PI / 4
    }
    const diagonal = Math.round((angle - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4
    return wrap(angle + wrap(diagonal - angle) * 0.4)
}

function cardAt(anchor: Point, angle: number, length: number) {
    const { width, height } = itineraryCardSize
    const c = Math.cos(angle), s = Math.sin(angle)
    const edge = 1 / Math.max(Math.abs(c) / (width / 2), Math.abs(s) / (height / 2))
    const cx = anchor.x + c * (length + edge), cy = anchor.y + s * (length + edge)
    return { left: cx - width / 2, top: cy - height / 2, end: { x: anchor.x + c * length, y: anchor.y + s * length } }
}

/**
 * Place compact day labels around the itinerary's macro shape. Each anchor prefers the outward normal of
 * its local route direction, leader lengths alternate along the principal axis, and previous placements
 * are kept when still valid so the layout stays stable across camera moves. Labels that cannot fit are hidden.
 */
export function layoutItineraryCards(anchors: MapCardAnchor[], bounds: Bounds, paths: Point[][] = [], previous: MapCardPlacement[] = []): MapCardPlacement[] {
    const { width, height } = itineraryCardSize
    if (bounds.right - bounds.left < width || bounds.bottom - bounds.top < height) return []
    const visible = anchors.filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && a.x >= bounds.left - 100 && a.x <= bounds.right + 100 && a.y >= bounds.top - 100 && a.y <= bounds.bottom + 100)
    if (!visible.length) return []
    const index = new SegmentIndex(paths, { left: bounds.left - 400, top: bounds.top - 400, right: bounds.right + 400, bottom: bounds.bottom + 400 })
    const shapePoints = index.segments.length ? index.segments.flatMap(([a, b]) => [a, b]) : visible
    const shape = routeShape(shapePoints)
    const prior = new Map(previous.map(p => {
        const end = itineraryLeaderEnd(p)
        return [p.id, { angle: Math.atan2(end.y - p.y, end.x - p.x), length: Math.hypot(end.x - p.x, end.y - p.y) }]
    }))

    // Stagger: alternate short/long leaders by order along the principal axis.
    const order = [...visible].sort((a, b) => (a.x * shape.axis.x + a.y * shape.axis.y) - (b.x * shape.axis.x + b.y * shape.axis.y) || a.id.localeCompare(b.id))
    const target = new Map(order.map((a, i) => [a.id, i % 2 ? 150 : 100]))
    // Nearby anchors form a cluster that fans out around its outward direction; angular order around
    // the cluster center matches the fan order so leaders never need to cross each other.
    const preferred = new Map<string, number>()
    const clusters: MapCardAnchor[][] = []
    for (const a of order) {
        const near = clusters.filter(c => c.some(b => Math.hypot(b.x - a.x, b.y - a.y) < 140))
        const merged = near.flat().concat(a)
        near.forEach(c => clusters.splice(clusters.indexOf(c), 1))
        clusters.push(merged)
    }
    for (const cluster of clusters) {
        const center = { x: cluster.reduce((s, a) => s + a.x, 0) / cluster.length, y: cluster.reduce((s, a) => s + a.y, 0) / cluster.length }
        const base = preferredAngle(center, index, shape)
        if (cluster.length === 1) { preferred.set(cluster[0].id, preferredAngle(cluster[0], index, shape)); continue }
        const radius = Math.max(...cluster.map(a => Math.hypot(a.x - center.x, a.y - center.y)))
        const step = Math.min(Math.PI * 0.24, Math.PI * 1.4 / (cluster.length - 1))
        const around = (a: MapCardAnchor) => Math.hypot(a.x - center.x, a.y - center.y) < 3 ? 0 : wrap(Math.atan2(a.y - center.y, a.x - center.x) - base)
        cluster.sort((a, b) => around(a) - around(b) || a.id.localeCompare(b.id)).forEach((a, i) => {
            preferred.set(a.id, wrap(base + (i - (cluster.length - 1) / 2) * step))
            target.set(a.id, Math.min(LENGTHS[LENGTHS.length - 2], radius * 0.6 + (i % 2 ? 150 : 100)))
        })
    }

    const placed = new Map<string, { anchor: MapCardAnchor; candidate: Candidate }>()
    const fits = (r: Bounds) => r.left >= bounds.left && r.top >= bounds.top && r.right <= bounds.right && r.bottom <= bounds.bottom

    const evaluate = (anchor: MapCardAnchor, left: number, top: number, end: Point, angle: number, length: number, extra = 0): Candidate | null => {
        const rect = rectOf(left, top)
        if (!fits(rect) || rectDistance(rect, anchor) < MIN_ANCHOR_GAP) return null
        const padded = rectOf(left, top, ANCHOR_PAD)
        if (visible.some(p => p.x > padded.left && p.x < padded.right && p.y > padded.top && p.y < padded.bottom)) return null
        const gapped = rectOf(left, top, CARD_GAP)
        let cost = extra
        for (const [id, other] of Array.from(placed)) {
            if (id === anchor.id) continue
            const o = rectOf(other.candidate.left, other.candidate.top)
            if (gapped.left < o.right && gapped.right > o.left && gapped.top < o.bottom && gapped.bottom > o.top) return null
            if (segmentHitsRect(anchor, end, rectOf(other.candidate.left, other.candidate.top, 4))) return null
            if (segmentHitsRect(other.anchor, other.candidate.end, rectOf(left, top, 4))) return null
            if (segmentsCross(anchor, end, other.anchor, other.candidate.end)) cost += 1200
            const spacing = Math.hypot(o.left - rect.left, (o.top - rect.top) * 2)
            if (spacing < 280) cost += (280 - spacing) * 0.6
        }
        const routeRect = rectOf(left, top, ROUTE_PAD)
        const hits = index.query(routeRect).filter(([a, b]) => segmentHitsRect(a, b, routeRect)).length
        cost += hits * 900
        const leaderBox = { left: Math.min(anchor.x, end.x), top: Math.min(anchor.y, end.y), right: Math.max(anchor.x, end.x), bottom: Math.max(anchor.y, end.y) }
        for (const [a, b] of index.query(leaderBox)) {
            if (pointSegmentDistance(anchor, a, b) > ANCHOR_PAD && segmentsCross(anchor, end, a, b)) cost += 70
        }
        cost += degDiff(angle, preferred.get(anchor.id)!) * 4
        cost += Math.abs(length - target.get(anchor.id)!) * 1.2 + (length - LENGTHS[0]) * 0.3
        const axisDistance = Math.min(...[0, 90, 180, 270].map(axis => degDiff(angle, axis * Math.PI / 180)))
        if (axisDistance < 18) cost += (18 - axisDistance) * 14
        const before = prior.get(anchor.id)
        if (before) cost += degDiff(angle, before.angle) * 3 + Math.abs(length - before.length) * 0.8 - (degDiff(angle, before.angle) < 1 && Math.abs(length - before.length) < 1 ? 160 : 0)
        return { left, top, end, angle, length, cost }
    }

    const best = (anchor: MapCardAnchor): Candidate | null => {
        let winner: Candidate | null = null
        const consider = (c: Candidate | null) => { if (c && (!winner || c.cost < winner.cost)) winner = c }
        const before = prior.get(anchor.id)
        if (before && before.length >= MIN_ANCHOR_GAP) {
            const card = cardAt(anchor, before.angle, before.length)
            consider(evaluate(anchor, card.left, card.top, card.end, before.angle, before.length))
        }
        for (const length of LENGTHS) {
            for (let step = 0; step < ANGLE_STEPS; step++) {
                const angle = wrap(step * Math.PI * 2 / ANGLE_STEPS)
                const card = cardAt(anchor, angle, length)
                consider(evaluate(anchor, card.left, card.top, card.end, angle, length))
            }
        }
        if (winner) return winner
        // Crowded shared bases may need any free slot in the viewport.
        for (let top = bounds.top; top + height <= bounds.bottom; top += height + CARD_GAP) {
            for (let left = bounds.left; left + width <= bounds.right; left += (width + 16) / 2) {
                const end = itineraryLeaderEnd({ ...anchor, left, top })
                const length = Math.hypot(end.x - anchor.x, end.y - anchor.y)
                consider(evaluate(anchor, left, top, end, Math.atan2(end.y - anchor.y, end.x - anchor.x), length, 2000 + length))
            }
        }
        return winner
    }

    // Most crowded anchors choose first; two refinement passes let early choices adapt to later ones.
    const crowd = (a: MapCardAnchor) => visible.filter(b => Math.hypot(a.x - b.x, a.y - b.y) < 260).length
    const sequence = [...visible].sort((a, b) => crowd(b) - crowd(a) || a.id.localeCompare(b.id))
    for (let pass = 0; pass < 3; pass++) {
        for (const anchor of sequence) {
            const current = placed.get(anchor.id)
            placed.delete(anchor.id)
            const candidate = best(anchor)
            if (candidate) placed.set(anchor.id, { anchor, candidate })
            else if (current) placed.set(anchor.id, current)
        }
    }
    // Untangle: swap the cards of two crossing leaders when the swap is still valid and removes crossings.
    const crossings = (id: string, a: MapCardAnchor, end: Point) => Array.from(placed.values()).filter(o => o.anchor.id !== id && segmentsCross(a, end, o.anchor, o.candidate.end)).length
    for (let round = 0; round < 3; round++) {
        let changed = false
        const items = Array.from(placed.values())
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const p = items[i], q = items[j]
                if (!segmentsCross(p.anchor, p.candidate.end, q.anchor, q.candidate.end)) continue
                const before = crossings(p.anchor.id, p.anchor, p.candidate.end) + crossings(q.anchor.id, q.anchor, q.candidate.end) - 1
                placed.delete(p.anchor.id); placed.delete(q.anchor.id)
                const swap = (anchor: MapCardAnchor, card: Candidate) => {
                    const end = itineraryLeaderEnd({ ...anchor, left: card.left, top: card.top })
                    return evaluate(anchor, card.left, card.top, end, Math.atan2(end.y - anchor.y, end.x - anchor.x), Math.hypot(end.x - anchor.x, end.y - anchor.y))
                }
                const np = swap(p.anchor, q.candidate)
                if (np) placed.set(p.anchor.id, { anchor: p.anchor, candidate: np })
                const nq = np && swap(q.anchor, p.candidate)
                if (np && nq && crossings(p.anchor.id, p.anchor, np.end) + crossings(q.anchor.id, q.anchor, nq.end) < before) {
                    placed.set(q.anchor.id, { anchor: q.anchor, candidate: nq })
                    items[i] = placed.get(p.anchor.id)!; items[j] = placed.get(q.anchor.id)!
                    changed = true
                } else {
                    placed.set(p.anchor.id, p); placed.set(q.anchor.id, q)
                }
            }
        }
        if (!changed) break
    }
    return visible.flatMap(anchor => {
        const item = placed.get(anchor.id)
        return item ? [{ ...anchor, left: Math.round(item.candidate.left), top: Math.round(item.candidate.top) }] : []
    })
}

export function sameItineraryPlacements(previous: MapCardPlacement[], next: MapCardPlacement[]): boolean {
    return previous.length === next.length && previous.every((item, i) => {
        const other = next[i]
        return item.id === other.id && item.x === other.x && item.y === other.y && item.left === other.left && item.top === other.top
    })
}
