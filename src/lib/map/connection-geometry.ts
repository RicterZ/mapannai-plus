/** 计算贝塞尔控制点 */
export function getControlPoint(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): { lat: number; lng: number } {
    const midLat = (from.lat + to.lat) / 2
    const midLng = (from.lng + to.lng) / 2
    const dLat = to.lat - from.lat
    const dLng = to.lng - from.lng
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist === 0) return { lat: midLat, lng: midLng }
    const offset = dist * 0.15
    return {
        lat: midLat - dLng * offset / dist,
        lng: midLng + dLat * offset / dist,
    }
}

/** 计算二次贝塞尔曲线在参数 t 处的坐标 [lng, lat] */
export function bezierPoint(
    from: { lat: number; lng: number },
    ctrl: { lat: number; lng: number },
    to: { lat: number; lng: number },
    t: number
): [number, number] {
    const lng = (1 - t) * (1 - t) * from.lng + 2 * (1 - t) * t * ctrl.lng + t * t * to.lng
    const lat = (1 - t) * (1 - t) * from.lat + 2 * (1 - t) * t * ctrl.lat + t * t * to.lat
    return [lng, lat]
}

/**
 * 生成二次贝塞尔曲线坐标点
 * 控制点为两点中点向垂直方向偏移，偏移量与两点距离成比例
 */
export function getBezierPath(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    numPoints = 32
): Array<[number, number]> {
    const ctrl = getControlPoint(from, to)
    if (ctrl.lat === from.lat && ctrl.lng === from.lng) {
        return [[from.lng, from.lat], [to.lng, to.lat]]
    }

    // 采样贝塞尔曲线
    const points: Array<[number, number]> = []
    for (let i = 0; i <= numPoints; i++) {
        points.push(bezierPoint(from, ctrl, to, i / numPoints))
    }
    return points
}

/**
 * Midpoint by screen length and its heading in degrees (clockwise from east, CSS rotate convention).
 * Web Mercator is conformal and these maps never rotate, so the heading is camera-independent.
 */
export function pathMidpointHeading(path: ReadonlyArray<ReadonlyArray<number>>): { position: [number, number]; heading: number } | null {
    const projected = path.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => {
        const clamped = Math.max(-85, Math.min(85, lat)) * Math.PI / 180
        return { lng, lat, x: lng, y: -Math.log(Math.tan(Math.PI / 4 + clamped / 2)) * 180 / Math.PI }
    })
    if (projected.length < 2) return null
    const lengths = projected.slice(1).map((p, i) => Math.hypot(p.x - projected[i].x, p.y - projected[i].y))
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!total) return null
    let remaining = total / 2
    for (let i = 0; i < lengths.length; i++) {
        if (remaining > lengths[i] && i < lengths.length - 1) { remaining -= lengths[i]; continue }
        const a = projected[i], b = projected[i + 1], t = lengths[i] ? remaining / lengths[i] : 0
        return { position: [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t], heading: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI }
    }
    return null
}
