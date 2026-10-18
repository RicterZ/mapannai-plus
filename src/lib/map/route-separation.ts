type Pixel = { x: number; y: number }

const project = ([lng, lat]: ReadonlyArray<number>, world: number): Pixel => {
    const clamped = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180
    return { x: (lng + 180) / 360 * world, y: (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2 * world }
}
const unproject = ({ x, y }: Pixel, world: number): [number, number] => {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) * 180 / Math.PI
    return [x / world * 360 - 180, lat]
}

/**
 * Display-only lane separation for links that share a corridor on screen. At the current zoom, vertices of
 * different paths that run near and parallel are grouped; each path takes a stable lane by its index and is
 * offset sideways by `spacing` pixels, tapered to zero near both ends so links still meet their places.
 * Lanes do not depend on highlight state, so hovering never makes lines jump. Paths without overlap are
 * returned unchanged. Input/output are display [lng, lat] arrays.
 */
export function separateOverlappingPaths(paths: number[][][], zoom: number, tileSize = 256, options: { spacing?: number; threshold?: number; taper?: number } = {}): number[][][] {
    const spacing = options.spacing ?? 5, threshold = options.threshold ?? 6, taper = options.taper ?? 24
    const world = tileSize * 2 ** zoom
    if (paths.length < 2 || !Number.isFinite(world)) return paths
    // Densify in screen space so long straight segments can still be compared vertex by vertex.
    let budget = 40000
    const dense: Pixel[][] = paths.map(path => {
        const points = path.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => project(p, world))
        const out: Pixel[] = []
        points.forEach((p, i) => {
            if (i) {
                const a = points[i - 1], steps = Math.min(200, Math.max(1, Math.floor(Math.hypot(p.x - a.x, p.y - a.y) / 4)))
                for (let k = 1; k < steps && budget > 0; k++, budget--) out.push({ x: a.x + (p.x - a.x) * k / steps, y: a.y + (p.y - a.y) * k / steps })
            }
            out.push(p)
        })
        return out
    })
    const tangent = (path: Pixel[], i: number) => {
        const a = path[Math.max(0, i - 2)], b = path[Math.min(path.length - 1, i + 2)]
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        return length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 }
    }
    const cells = new Map<string, Array<[number, number]>>()
    dense.forEach((path, pi) => path.forEach((p, vi) => {
        const key = `${Math.floor(p.x / threshold)}:${Math.floor(p.y / threshold)}`
        const list = cells.get(key)
        if (list) list.push([pi, vi]); else cells.set(key, [[pi, vi]])
    }))

    const result = paths.slice()
    dense.forEach((path, pi) => {
        if (path.length < 2) return
        const lateral = new Float64Array(path.length)
        const normals: Pixel[] = []
        let touched = false
        path.forEach((p, vi) => {
            const own = tangent(path, vi)
            // Nearest parallel vertex of every other path near this vertex.
            const near = new Map<number, number>()
            const cx = Math.floor(p.x / threshold), cy = Math.floor(p.y / threshold)
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                for (const [pj, vj] of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
                    if (pj === pi) continue
                    const q = dense[pj][vj], d = Math.hypot(q.x - p.x, q.y - p.y)
                    if (d > threshold) continue
                    const t = tangent(dense[pj], vj)
                    if (Math.abs(t.x * own.x + t.y * own.y) < 0.8) continue
                    const best = near.get(pj)
                    if (best === undefined || d < Math.hypot(dense[pj][best].x - p.x, dense[pj][best].y - p.y)) near.set(pj, vj)
                }
            }
            normals.push({ x: -own.y, y: own.x })
            if (!near.size) return
            // Shared reference direction from the lowest-index member keeps every member's normal identical.
            const members = [pi, ...Array.from(near.keys())].sort((a, b) => a - b)
            const reference = members[0] === pi ? own : tangent(dense[members[0]], near.get(members[0])!)
            const sign = reference.x * own.x + reference.y * own.y >= 0 ? 1 : -1
            lateral[vi] = (members.indexOf(pi) - (members.length - 1) / 2) * spacing * sign
            touched = true
        })
        if (!touched) return
        // Smooth lane changes along the path, then taper to the endpoints.
        const smoothed = new Float64Array(path.length)
        const window = 6
        for (let i = 0; i < path.length; i++) {
            let sum = 0, count = 0
            for (let k = Math.max(0, i - window); k <= Math.min(path.length - 1, i + window); k++) { sum += lateral[k]; count++ }
            smoothed[i] = sum / count
        }
        const along = [0]
        for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
        const total = along[along.length - 1]
        result[pi] = path.map((p, i) => {
            const fade = Math.min(1, along[i] / taper, (total - along[i]) / taper)
            const offset = smoothed[i] * Math.max(0, fade)
            return unproject({ x: p.x + normals[i].x * offset, y: p.y + normals[i].y * offset }, world)
        })
    })
    return result
}
