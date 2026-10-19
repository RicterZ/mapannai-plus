export interface MapCardAnchor { id: string; x: number; y: number; height?: number; width?: number }
export interface MapCardPlacement extends MapCardAnchor { left: number; top: number }
export const itineraryCardSize = { width: 280, minWidth: 208, height: 132 }

type Point = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
type Segment = [Point, Point]
interface Candidate { left: number; top: number; end: Point; angle: number; length: number; key: string; unary: number; u?: number; v?: number; side?: number; polar?: number }

// A small fixed vocabulary of leader directions gives the map a consistent rhythm; shallow diagonals suit wide cards.
const DIRECTIONS = [-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 0, 180]
const LENGTHS = [24, 40, 64, 96, 136, 184]
const CARD_GAP = 10
const ANCHOR_PAD = 14
const CLEARANCE = 24
const HARD = 100000
const FREE_STEP = 12
// Covering a pin is discouraged rather than forbidden, so clustered pins cannot force cards to stack.
const PIN_COVER = 6000
// Cards covering routes hide the pins and lines beneath them; cost grows with the covered route length.
const ROUTE_COVER = 80

// Intersect the center-to-anchor ray with the card edge, preserving its angle.
export function itineraryLeaderEnd(p: MapCardPlacement): Point {
    const width = p.width ?? itineraryCardSize.width
    const height = p.height ?? itineraryCardSize.height
    const cx = p.left + width / 2, cy = p.top + height / 2
    const dx = p.x - cx, dy = p.y - cy
    const scale = 1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2), 1)
    return { x: cx + dx * scale, y: cy + dy * scale }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const degDiff = (a: number, b: number) => Math.abs(wrap(a - b)) * 180 / Math.PI
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
const rectOf = (left: number, top: number, pad = 0, height = itineraryCardSize.height, width = itineraryCardSize.width): Bounds => ({ left: left - pad, top: top - pad, right: left + width + pad, bottom: top + height + pad })
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
/** Length of a segment inside a rectangle (Liang–Barsky clipping). */
function clippedLength(a: Point, b: Point, r: Bounds) {
    let low = 0, high = 1
    for (const [start, delta, min, max] of [[a.x, b.x - a.x, r.left, r.right], [a.y, b.y - a.y, r.top, r.bottom]]) {
        if (!delta) { if (start < min || start > max) return 0; continue }
        const enter = (min - start) / delta, exit = (max - start) / delta
        low = Math.max(low, Math.min(enter, exit)); high = Math.min(high, Math.max(enter, exit))
        if (low >= high) return 0
    }
    return (high - low) * Math.hypot(b.x - a.x, b.y - a.y)
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

/**
 * Macro shape of the itinerary from route geometry and anchors. Elongated routes (vertical, horizontal or
 * diagonal) get labels in two bands parallel to the principal axis; round routes and closed loops get labels
 * on an outer ring around the centroid.
 */
interface RouteShape { kind: 'linear' | 'radial'; center: Point; axis: Point; normal: Point }
function routeShape(paths: Point[][], anchors: Point[]): RouteShape {
    const points: Point[] = [...anchors]
    for (const path of paths) for (let i = 0; i < path.length; i += Math.max(1, Math.floor(path.length / 40))) {
        const p = path[i]
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p)
    }
    const center = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
    let xx = 0, yy = 0, xy = 0
    for (const p of points) { const dx = p.x - center.x, dy = p.y - center.y; xx += dx * dx; yy += dy * dy; xy += dx * dy }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy)
    const mean = (xx + yy) / 2, spread = Math.hypot((xx - yy) / 2, xy)
    const ratio = mean + spread > 0 ? (mean - spread) / (mean + spread) : 1
    const axis = { x: Math.cos(theta), y: Math.sin(theta) }
    const normal = { x: -axis.y, y: axis.x }
    // Closed loops and compact clusters both have comparable spread on the two axes.
    return { kind: ratio > 0.4 ? 'radial' : 'linear', center, axis, normal }
}

function cardAt(anchor: MapCardAnchor, angle: number, length: number) {
    const width = anchor.width ?? itineraryCardSize.width
    const height = anchor.height ?? itineraryCardSize.height
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
    const shape = routeShape(paths.map(path => path.filter(p => p.x >= bounds.left - 400 && p.x <= bounds.right + 400 && p.y >= bounds.top - 400 && p.y <= bounds.bottom + 400)).filter(path => path.length), visible)
    const dot = (p: Point, d: Point) => p.x * d.x + p.y * d.y
    const normalAngle = Math.atan2(shape.normal.y, shape.normal.x)
    // Axis-perpendicular leaders suit diagonal routes that the fixed screen directions approximate poorly.
    const angles = [...DIRECTIONS.map(deg => deg * Math.PI / 180), ...(shape.kind === 'linear' ? [0, Math.PI].flatMap(base => [-0.45, 0, 0.45].map(offset => wrap(normalAngle + base + offset))) : [])]
        .filter((angle, i, all) => all.findIndex(other => degDiff(angle, other) < 8) === i)
    const axisRank = visible.map((a, i) => i).sort((i, j) => dot(visible[i], shape.axis) - dot(visible[j], shape.axis))
    const decorate = (anchor: MapCardAnchor, left: number, top: number, height: number) => {
        const card = { x: left + (anchor.width ?? width) / 2, y: top + height / 2 }
        const rel = { x: card.x - shape.center.x, y: card.y - shape.center.y }
        return { u: dot(rel, shape.axis), v: dot(rel, shape.normal), side: Math.sign(dot({ x: card.x - anchor.x, y: card.y - anchor.y }, shape.normal)) || 1, polar: Math.atan2(rel.y, rel.x) }
    }

    const coveredPins = (r: Bounds) => visible.filter(p => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom).length * PIN_COVER
    const routeCost = (left: number, top: number, height: number, cardWidth: number) => {
        const rect = rectOf(left, top, 0, height, cardWidth), hit = rectOf(left, top, 4, height, cardWidth)
        let clearance = CLEARANCE, covered = 0
        for (const [a, b] of index.query(rectOf(left, top, CLEARANCE, height, cardWidth))) {
            clearance = Math.min(clearance, rectSegmentDistance(rect, a, b))
            covered += clippedLength(a, b, hit)
        }
        return covered > 0 ? 800 + covered * ROUTE_COVER : (CLEARANCE - clearance) * 18
    }

    const options: Candidate[][] = visible.map((anchor, anchorIndex) => {
        const height = anchor.height ?? itineraryCardSize.height, cardWidth = anchor.width ?? itineraryCardSize.width
        const free = freeDirection(anchor, index, visible, center)
        const before = prior.get(anchor.id)
        // Linear routes: the side away from local route mass, then the side away from the axis, then alternate along the axis.
        let preferred: number
        if (shape.kind === 'linear') {
            const local = Math.cos(free.angle - normalAngle) * free.strength
            const offset = dot({ x: anchor.x - shape.center.x, y: anchor.y - shape.center.y }, shape.normal)
            const side = Math.abs(local) > 0.15 ? Math.sign(local) : Math.abs(offset) > 20 ? Math.sign(offset) : axisRank.indexOf(anchorIndex) % 2 ? 1 : -1
            preferred = side > 0 ? normalAngle : wrap(normalAngle + Math.PI)
        } else {
            const dx = anchor.x - shape.center.x, dy = anchor.y - shape.center.y
            preferred = Math.hypot(dx, dy) > 24 ? Math.atan2(dy, dx) : free.angle
        }
        const list: Candidate[] = []
        LENGTHS.forEach((length, li) => angles.forEach(angle => {
            const deg = Math.round(angle * 180 / Math.PI)
            const { left, top, end } = cardAt(anchor, angle, length)
            const rect = rectOf(left, top, 0, height, cardWidth)
            if (!inside(rect)) return
            let unary = coveredPins(rectOf(left, top, ANCHOR_PAD, height, cardWidth)) + (length - LENGTHS[0]) * 2.4 + (li >= 3 ? 300 : 0) + (li >= 4 ? 500 : 0)
            unary += degDiff(angle, preferred) * 2 + degDiff(angle, free.angle) * free.strength
            if (shape.kind === 'radial' && (deg === 0 || Math.abs(deg) === 180)) unary += 50
            unary += routeCost(left, top, height, cardWidth)
            const box = { left: Math.min(anchor.x, end.x), top: Math.min(anchor.y, end.y), right: Math.max(anchor.x, end.x), bottom: Math.max(anchor.y, end.y) }
            for (const [a, b] of index.query(box)) if (pointSegmentDistance(anchor, a, b) > ANCHOR_PAD && segmentsCross(anchor, end, a, b)) unary += 140
            list.push({ left, top, end, angle, length, key: `${deg}:${length}`, unary, ...decorate(anchor, left, top, height) })
        }))
        // Keep the previous offset as an explicit candidate; it only moves when it becomes clearly worse.
        if (before) {
            const { left, top, end } = cardAt(anchor, before.angle, before.length)
            const rect = rectOf(left, top, 0, height, cardWidth)
            if (inside(rect) && rectPointDistance(rect, anchor) >= LENGTHS[0] - 1) {
                const unary = coveredPins(rectOf(left, top, ANCHOR_PAD, height, cardWidth)) + routeCost(left, top, height, cardWidth) - 1500
                list.push({ left, top, end, angle: before.angle, length: before.length, key: 'previous', unary, ...decorate(anchor, left, top, height) })
            }
        }
        return list.sort((a, b) => a.unary - b.unary)
    })

    const reach = LENGTHS[LENGTHS.length - 1] + width * 1.2
    const neighbors = visible.map((a, i) => visible.flatMap((b, j) => j !== i && Math.hypot(a.x - b.x, a.y - b.y) < reach * 2 ? [j] : []))
    const pair = (i: number, p: Candidate, j: number, q: Candidate) => {
        const a = visible[i], b = visible[j]
        const pr = rectOf(p.left, p.top, 0, a.height, a.width), qr = rectOf(q.left, q.top, 0, b.height, b.width)
        if (overlaps(rectOf(p.left, p.top, CARD_GAP, a.height, a.width), qr)) return HARD
        let cost = segmentsCross(a, p.end, b, q.end) ? 900 : 0
        if (segmentHitsRect(a, p.end, rectOf(q.left, q.top, 4, b.height, b.width))) cost += 3000
        if (segmentHitsRect(b, q.end, rectOf(p.left, p.top, 4, a.height, a.width))) cost += 3000
        const near = Math.hypot(a.x - b.x, a.y - b.y)
        if (near < 220) cost += Math.min(60, degDiff(p.angle, q.angle) * 0.5) * (1 - near / 220)
        if (shape.kind === 'linear') {
            // Each side reads as a band parallel to the route: same order as the anchors, edges on a shared offset.
            if (p.side === q.side && Math.abs(p.u! - q.u!) < reach * 1.5) {
                if ((dot(a, shape.axis) - dot(b, shape.axis)) * (p.u! - q.u!) < 0) cost += 700
                const dv = Math.abs(p.v! - q.v!)
                if (dv < 6) cost -= 50; else if (dv < 28) cost += 20
            }
        } else {
            // Ring labels keep the angular order of their anchors around the centroid.
            const anchorTurn = wrap(Math.atan2(a.y - shape.center.y, a.x - shape.center.x) - Math.atan2(b.y - shape.center.y, b.x - shape.center.x))
            if (near < reach && Math.abs(anchorTurn) > 0.05 && anchorTurn * wrap(p.polar! - q.polar!) < 0) cost += 600
            if (Math.abs(pr.top - qr.top) < 240 && Math.abs(pr.left - qr.left) < reach) {
                const dl = Math.min(Math.abs(pr.left - qr.left), Math.abs(pr.right - qr.right))
                if (dl < 4) cost -= 40; else if (dl < 24) cost += 24
            }
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
    const anneal = (steps: number, heat: number) => {
        for (let step = 0; step < steps; step++) {
            const temperature = heat * Math.pow(0.002, step / steps)
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
    }
    // Once free slots are added, searches only scan each label's cheapest candidates.
    let pool: number[][] = options.map(list => list.map((_, c) => c))
    const bestOf = (i: number, margin = 0) => {
        let best = choice[i], bestCost = choice[i] >= 0 ? local(i, choice[i]) : Infinity
        for (const c of pool[i]) { const cost = local(i, c); if (cost < bestCost - margin) { best = c; bestCost = cost } }
        return best
    }
    const descend = () => {
        for (let round = 0; round < 3; round++) for (const i of order) choice[i] = bestOf(i, 0.01)
    }
    anneal(Math.min(24000, visible.length * 900), 400)
    descend()
    // Labels are never hidden. A blocked label can only be freed if its neighbours may move too, and free slots let
    // labels leave crowded route corridors, so every label gets viewport free slots and the search reruns. The grid
    // step grows with the viewport to keep roughly 1500 slots per label.
    const freeStep = Math.max(FREE_STEP, Math.sqrt((bounds.right - bounds.left) * (bounds.bottom - bounds.top) / 1500))
    const steps = (min: number, max: number) => {
        const values: number[] = []
        for (let v = min; v < max; v += freeStep) values.push(v)
        if (max >= min) values.push(max)
        return values
    }
    const freed = new Set<number>()
    const addFree = (i: number) => {
        if (freed.has(i)) return
        freed.add(i)
        const anchor = visible[i]
        const height = anchor.height ?? itineraryCardSize.height, cardWidth = anchor.width ?? itineraryCardSize.width
        for (const top of steps(bounds.top, bounds.bottom - height)) {
            for (const left of steps(bounds.left, bounds.right - cardWidth)) {
                if (rectPointDistance(rectOf(left, top, 0, height, cardWidth), anchor) < LENGTHS[0]) continue
                const end = itineraryLeaderEnd({ ...anchor, left, top })
                const length = Math.hypot(end.x - anchor.x, end.y - anchor.y)
                const unary = 2000 + length * 20 + routeCost(left, top, height, cardWidth) + coveredPins(rectOf(left, top, ANCHOR_PAD, height, cardWidth))
                options[i].push({ left, top, end, angle: Math.atan2(end.y - anchor.y, end.x - anchor.x), length, key: 'free', unary, ...decorate(anchor, left, top, height) })
            }
        }
        // Distant free slots can reach labels outside the neighbour radius.
        visible.forEach((_, j) => {
            if (j === i) return
            if (!neighbors[i].includes(j)) neighbors[i].push(j)
            if (!neighbors[j].includes(i)) neighbors[j].push(i)
        })
    }
    const conflicted = () => order.filter(i => choice[i] < 0 || local(i, choice[i]) >= HARD)
    // Repair only when the main search left overlaps or cards covering pins or routes.
    const covering = () => visible.some((_, i) => choice[i] < 0 || options[i][choice[i]].unary >= 800)
    if (!conflicted().length && !covering()) return finish()
    visible.forEach((_, i) => addFree(i))
    pool = options.map(list => list.map((_, c) => c).sort((a, b) => list[a].unary - list[b].unary).slice(0, 300))
    pool.forEach((list, i) => { if (choice[i] >= 0 && !list.includes(choice[i])) list.push(choice[i]) })
    for (const i of conflicted()) choice[i] = bestOf(i)
    descend()
    // Random moves rarely free a slot that needs a third label to move first. Rebuild greedily in a few deterministic
    // orders, each label taking the best slot among those already placed, and keep the cheapest.
    const total = () => visible.reduce((sum, _, i) => sum + local(i, choice[i]), 0)
    let bestChoice = choice.slice(), bestTotal = total()
    const byArea = visible.map((_, i) => i).sort((i, j) => (visible[j].width ?? width) * (visible[j].height ?? height) - (visible[i].width ?? width) * (visible[i].height ?? height))
    const byY = visible.map((_, i) => i).sort((i, j) => visible[i].y - visible[j].y)
    for (const sequence of [order, byArea, byY]) {
        choice.fill(-1)
        for (const i of sequence) choice[i] = bestOf(i)
        descend()
        const cost = total()
        if (cost < bestTotal) { bestTotal = cost; bestChoice = choice.slice() }
    }
    bestChoice.forEach((c, i) => { choice[i] = c })
    // Ejection moves for labels that still overlap or cover pins/routes: try a better slot, relocating at most two
    // labels it would hit.
    const shortlist = pool.map(list => list.slice(0, 60))
    // Only the moved labels' own costs change, so compare those instead of the whole layout.
    for (let round = 0; round < 4; round++) {
        let improved = false
        for (const i of order) {
            if (choice[i] >= 0 && options[i][choice[i]].unary < 800 && local(i, choice[i]) < HARD) continue
            for (const c of shortlist[i]) {
                const before = local(i, choice[i])
                if (c === choice[i] || options[i][c].unary >= before) continue
                const old = choice[i]
                choice[i] = c
                const hits = neighbors[i].filter(j => choice[j] >= 0 && pair(i, options[i][c], j, options[j][choice[j]]) >= HARD)
                if (hits.length > 2) { choice[i] = old; continue }
                const saved = hits.map(j => choice[j])
                choice[i] = old
                const previous = before + hits.reduce((sum, j) => sum + local(j, choice[j]), 0)
                choice[i] = c
                for (const j of hits) {
                    let best = -1, bestCost = Infinity
                    for (const k of shortlist[j]) { const cost = local(j, k); if (cost < bestCost) { best = k; bestCost = cost } }
                    choice[j] = best
                }
                const next = local(i, c) + hits.reduce((sum, j) => sum + local(j, choice[j]), 0)
                if (next < previous - 1) improved = true
                else { choice[i] = old; hits.forEach((j, k) => { choice[j] = saved[k] }) }
            }
        }
        if (!improved) break
    }
    // Last resort for overlaps the deterministic passes could not resolve.
    for (let round = 0; round < 2 && conflicted().length; round++) {
        anneal(Math.min(24000, visible.length * 900), 2000)
        descend()
    }
    return finish()

    function finish() {
        return visible.flatMap((anchor, i) => {
            const c = options[i][choice[i]]
            return c ? [{ ...anchor, left: Math.round(c.left), top: Math.round(c.top) }] : []
        })
    }
}

export function sameItineraryPlacements(previous: MapCardPlacement[], next: MapCardPlacement[]): boolean {
    return previous.length === next.length && previous.every((item, i) => {
        const other = next[i]
        return item.id === other.id && item.x === other.x && item.y === other.y && item.left === other.left && item.top === other.top && item.height === other.height && item.width === other.width
    })
}
