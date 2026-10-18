export interface MapCardAnchor { id: string; x: number; y: number }
export interface MapCardPlacement extends MapCardAnchor { left: number; top: number }
export const itineraryCardSize = { width: 208, height: 40 }

type Point = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
type Segment = [Point, Point]
interface Candidate { left: number; top: number; end: Point; angle: number; length: number; key: string; unary: number }

// A small fixed vocabulary of leader directions gives the map a consistent rhythm; shallow diagonals suit wide cards.
const DIRECTIONS = [-150, -120, -60, -30, 30, 60, 120, 150, 0, 180]
const LENGTHS = [80, 104, 136, 176, 232, 300]
const CARD_GAP = 10
const ANCHOR_PAD = 14
const CLEARANCE = 24
const HARD = 100000

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
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
const rectOf = (left: number, top: number, pad = 0): Bounds => ({ left: left - pad, top: top - pad, right: left + itineraryCardSize.width + pad, bottom: top + itineraryCardSize.height + pad })
const overlaps = (a: Bounds, b: Bounds) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const rectPointDistance = (r: Bounds, p: Point) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom))

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
function rectSegmentDistance(r: Bounds, a: Point, b: Point) {
    if (segmentHitsRect(a, b, r)) return 0
    const corners = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]
    return Math.min(rectPointDistance(r, a), rectPointDistance(r, b), ...corners.map(c => pointSegmentDistance(c, a, b)))
}

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

/**
 * Direction of open space around an anchor at the scale of the whole itinerary: away from the mass of nearby
 * route geometry and other anchors, so labels sit on the outside of the route silhouette. Strength is 0..1.
 */
function freeDirection(anchor: Point, index: SegmentIndex, anchors: Point[], center: Point) {
    let fx = 0, fy = 0, mass = 0
    const push = (p: Point, weight: number) => {
        const dx = anchor.x - p.x, dy = anchor.y - p.y, d = Math.hypot(dx, dy)
        if (d < 2 || d > 320) return
        const w = weight / (40 + d)
        fx += dx / d * w; fy += dy / d * w; mass += w
    }
    for (const [a, b] of index.query({ left: anchor.x - 320, top: anchor.y - 320, right: anchor.x + 320, bottom: anchor.y + 320 })) {
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, length)
    }
    for (const p of anchors) push(p, 60)
    const strength = mass ? Math.hypot(fx, fy) / mass : 0
    if (strength > 0.12) return { angle: Math.atan2(fy, fx), strength: Math.min(1, strength * 1.6) }
    const dx = anchor.x - center.x, dy = anchor.y - center.y
    return Math.hypot(dx, dy) > 24 ? { angle: Math.atan2(dy, dx), strength: 0.4 } : { angle: -Math.PI / 6, strength: 0.2 }
}

function cardAt(anchor: Point, angle: number, length: number) {
    const { width, height } = itineraryCardSize
    const c = Math.cos(angle), s = Math.sin(angle)
    const edge = 1 / Math.max(Math.abs(c) / (width / 2), Math.abs(s) / (height / 2))
    const cx = anchor.x + c * (length + edge), cy = anchor.y + s * (length + edge)
    return { left: cx - width / 2, top: cy - height / 2, end: { x: anchor.x + c * length, y: anchor.y + s * length } }
}

function seeded(text: string) {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
    return () => {
        h = Math.imul(h ^ (h >>> 15), h | 1); h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
        return ((h ^ (h >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Leader labeling as a discrete optimization. Every anchor picks one candidate (fixed direction × short
 * length band) or stays hidden. Unary cost prefers short leaders, clearance from routes and the open side of
 * the route silhouette; pairwise cost forbids overlaps, penalizes crossings, and rewards consistent directions
 * and aligned edges between neighbors. Simulated annealing with a deterministic seed finds the assignment;
 * the previous choice of each label gets a hysteresis bonus so camera moves do not reshuffle the layout.
 */
export function layoutItineraryCards(anchors: MapCardAnchor[], bounds: Bounds, paths: Point[][] = [], previous: MapCardPlacement[] = []): MapCardPlacement[] {
    const { width, height } = itineraryCardSize
    if (bounds.right - bounds.left < width || bounds.bottom - bounds.top < height) return []
    const visible = anchors.filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && a.x >= bounds.left - 100 && a.x <= bounds.right + 100 && a.y >= bounds.top - 100 && a.y <= bounds.bottom + 100)
    if (!visible.length) return []
    const index = new SegmentIndex(paths, { left: bounds.left - 400, top: bounds.top - 400, right: bounds.right + 400, bottom: bounds.bottom + 400 })
    const center = { x: visible.reduce((s, a) => s + a.x, 0) / visible.length, y: visible.reduce((s, a) => s + a.y, 0) / visible.length }
    const prior = new Map(previous.map(p => {
        const end = itineraryLeaderEnd(p)
        return [p.id, { angle: Math.atan2(end.y - p.y, end.x - p.x), length: Math.hypot(end.x - p.x, end.y - p.y) }]
    }))
    const inside = (r: Bounds) => r.left >= bounds.left && r.top >= bounds.top && r.right <= bounds.right && r.bottom <= bounds.bottom

    const options: Candidate[][] = visible.map(anchor => {
        const free = freeDirection(anchor, index, visible, center)
        const before = prior.get(anchor.id)
        const list: Candidate[] = []
        LENGTHS.forEach((length, li) => DIRECTIONS.forEach(deg => {
            const angle = deg * Math.PI / 180
            const { left, top, end } = cardAt(anchor, angle, length)
            const rect = rectOf(left, top)
            if (!inside(rect)) return
            const padded = rectOf(left, top, ANCHOR_PAD)
            if (visible.some(p => p.x > padded.left && p.x < padded.right && p.y > padded.top && p.y < padded.bottom)) return
            let unary = (length - LENGTHS[0]) * 1.4 + (li >= 4 ? 400 : 0)
            unary += degDiff(angle, free.angle) * 2.4 * free.strength
            if (deg === 0 || deg === 180) unary += 50
            let clearance = CLEARANCE
            for (const [a, b] of index.query(rectOf(left, top, CLEARANCE))) clearance = Math.min(clearance, rectSegmentDistance(rect, a, b))
            unary += clearance === 0 ? 1600 : (CLEARANCE - clearance) * 18
            const box = { left: Math.min(anchor.x, end.x), top: Math.min(anchor.y, end.y), right: Math.max(anchor.x, end.x), bottom: Math.max(anchor.y, end.y) }
            for (const [a, b] of index.query(box)) if (pointSegmentDistance(anchor, a, b) > ANCHOR_PAD && segmentsCross(anchor, end, a, b)) unary += 140
            list.push({ left, top, end, angle, length, key: `${deg}:${length}`, unary })
        }))
        // Keep the previous offset as an explicit candidate; it only moves when it becomes clearly worse.
        if (before) {
            const { left, top, end } = cardAt(anchor, before.angle, before.length)
            const rect = rectOf(left, top), padded = rectOf(left, top, ANCHOR_PAD)
            if (inside(rect) && rectPointDistance(rect, anchor) >= LENGTHS[0] - 1 && !visible.some(p => p.x > padded.left && p.x < padded.right && p.y > padded.top && p.y < padded.bottom)) {
                let clearance = CLEARANCE
                for (const [a, b] of index.query(rectOf(left, top, CLEARANCE))) clearance = Math.min(clearance, rectSegmentDistance(rect, a, b))
                list.push({ left, top, end, angle: before.angle, length: before.length, key: 'previous', unary: (clearance === 0 ? 1600 : 0) - 1500 })
            }
        }
        return list.sort((a, b) => a.unary - b.unary)
    })

    const reach = LENGTHS[LENGTHS.length - 1] + width * 1.2
    const neighbors = visible.map((a, i) => visible.flatMap((b, j) => j !== i && Math.hypot(a.x - b.x, a.y - b.y) < reach * 2 ? [j] : []))
    const pair = (i: number, p: Candidate, j: number, q: Candidate) => {
        const a = visible[i], b = visible[j]
        const pr = rectOf(p.left, p.top), qr = rectOf(q.left, q.top)
        if (overlaps(rectOf(p.left, p.top, CARD_GAP), qr)) return HARD
        let cost = segmentsCross(a, p.end, b, q.end) ? 900 : 0
        if (segmentHitsRect(a, p.end, rectOf(q.left, q.top, 4))) cost += 3000
        if (segmentHitsRect(b, q.end, rectOf(p.left, p.top, 4))) cost += 3000
        const near = Math.hypot(a.x - b.x, a.y - b.y)
        if (near < 220) cost += Math.min(60, degDiff(p.angle, q.angle) * 0.5) * (1 - near / 220)
        const sameSide = Math.sign(Math.cos(p.angle)) === Math.sign(Math.cos(q.angle))
        if (sameSide && Math.abs(pr.left - qr.left) < reach && Math.abs(pr.top - qr.top) < 240) {
            const dl = Math.min(Math.abs(pr.left - qr.left), Math.abs(pr.right - qr.right))
            if (dl < 4) cost -= 40; else if (dl < 24) cost += 24
        }
        return cost
    }

    const choice = visible.map(() => -1)
    const local = (i: number, c: number) => {
        if (c < 0) return HARD * 10
        let cost = options[i][c].unary
        for (const j of neighbors[i]) if (choice[j] >= 0) cost += pair(i, options[i][c], j, options[j][choice[j]])
        return cost
    }
    // Greedy start from the most constrained anchors, then anneal.
    const crowd = visible.map((a, i) => neighbors[i].filter(j => Math.hypot(a.x - visible[j].x, a.y - visible[j].y) < 260).length)
    const order = visible.map((_, i) => i).sort((i, j) => crowd[j] - crowd[i] || options[i].length - options[j].length || visible[i].id.localeCompare(visible[j].id))
    for (const i of order) {
        let best = -1, bestCost = Infinity
        options[i].forEach((_, c) => { const cost = local(i, c); if (cost < bestCost) { best = c; bestCost = cost } })
        choice[i] = best
    }
    const random = seeded(visible.map(a => a.id).join('|'))
    const steps = Math.min(24000, visible.length * 900)
    for (let step = 0; step < steps; step++) {
        const temperature = 400 * Math.pow(0.002, step / steps)
        const i = Math.floor(random() * visible.length)
        if (!options[i].length) continue
        const next = Math.floor(random() * options[i].length)
        if (next === choice[i]) continue
        const current = local(i, choice[i])
        const old = choice[i]
        choice[i] = next
        const delta = local(i, next) - current
        if (delta > 0 && random() >= Math.exp(-delta / temperature)) choice[i] = old
    }
    // Final descent; labels are never hidden, so violations fall back to free slots below.
    for (let round = 0; round < 3; round++) for (const i of order) {
        let best = choice[i], bestCost = local(i, choice[i])
        options[i].forEach((_, c) => { const cost = local(i, c); if (cost < bestCost - 0.01) { best = c; bestCost = cost } })
        choice[i] = best
    }
    // Crowded shared bases may need any free slot in the viewport rather than losing a day label.
    for (const i of order) {
        if (choice[i] >= 0 && local(i, choice[i]) < HARD) continue
        const anchor = visible[i], start = options[i].length
        for (let top = bounds.top; top + height <= bounds.bottom; top += height + CARD_GAP) {
            for (let left = bounds.left; left + width <= bounds.right; left += (width + 16) / 2) {
                const rect = rectOf(left, top), padded = rectOf(left, top, ANCHOR_PAD)
                if (rectPointDistance(rect, anchor) < LENGTHS[0] || visible.some(p => p.x > padded.left && p.x < padded.right && p.y > padded.top && p.y < padded.bottom)) continue
                const end = itineraryLeaderEnd({ ...anchor, left, top })
                const length = Math.hypot(end.x - anchor.x, end.y - anchor.y)
                options[i].push({ left, top, end, angle: Math.atan2(end.y - anchor.y, end.x - anchor.x), length, key: 'free', unary: 2000 + length * 2 })
            }
        }
        // If nothing is fully clear, keep the least conflicting position instead of hiding the label.
        let best = choice[i], bestCost = local(i, choice[i])
        for (let c = start; c < options[i].length; c++) { const cost = local(i, c); if (cost < bestCost) { best = c; bestCost = cost } }
        choice[i] = best
    }

    return visible.flatMap((anchor, i) => {
        const c = options[i][choice[i]]
        return c ? [{ ...anchor, left: Math.round(c.left), top: Math.round(c.top) }] : []
    })
}

export function sameItineraryPlacements(previous: MapCardPlacement[], next: MapCardPlacement[]): boolean {
    return previous.length === next.length && previous.every((item, i) => {
        const other = next[i]
        return item.id === other.id && item.x === other.x && item.y === other.y && item.left === other.left && item.top === other.top
    })
}
