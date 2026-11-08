'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { MapCardPlacement } from '@/lib/map/itinerary-card-layout'

/** A card's offset from its anchor; anchors themselves move with the map. */
export interface AnimatedPlacement { id: string; dx: number; dy: number; width?: number; height?: number; opacity: number; leaving: boolean }

const DURATION = 320
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * A new layout glides each kept card to its new offset, fades in
 * cards that start showing and fades out cards that stop showing.
 */
export function useAnimatedPlacements(placements: MapCardPlacement[], seed?: MutableRefObject<Map<string, { dx: number; dy: number }> | null>): AnimatedPlacement[] {
    const [shown, setShown] = useState<AnimatedPlacement[]>([])
    const current = useRef<AnimatedPlacement[]>([])
    useEffect(() => {
        const from = new Map(current.current.map(item => [item.id, item]))
        seed?.current?.forEach((offset, id) => from.set(id, { ...(from.get(id) ?? { id, opacity: 1, leaving: false }), ...offset }))
        if (seed) seed.current = null
        const target = placements.map(p => ({ id: p.id, dx: p.left - p.x, dy: p.top - p.y, width: p.width, height: p.height }))
        const ids = new Set(target.map(item => item.id))
        const leaving = current.current.filter(item => !ids.has(item.id) && item.opacity > 0.01)
        const commit = (items: AnimatedPlacement[]) => { current.current = items; setShown(items) }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return commit(target.map(item => ({ ...item, opacity: 1, leaving: false })))
        let frame = 0
        const start = performance.now()
        const step = (now: number) => {
            const t = ease(Math.min(1, (now - start) / DURATION))
            commit([
                ...target.map(item => {
                    const was = from.get(item.id)
                    const opacity = was && !was.leaving ? was.opacity : was?.opacity ?? 0
                    return { ...item, dx: was ? was.dx + (item.dx - was.dx) * t : item.dx, dy: was ? was.dy + (item.dy - was.dy) * t : item.dy, opacity: opacity + (1 - opacity) * t, leaving: false }
                }),
                ...leaving.map(item => ({ ...item, opacity: item.opacity * (1 - t), leaving: true })),
            ].filter(item => !item.leaving || item.opacity > 0.01))
            if (t < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
    }, [placements])
    return shown
}
