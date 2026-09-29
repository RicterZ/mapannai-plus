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

