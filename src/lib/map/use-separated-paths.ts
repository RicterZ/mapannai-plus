'use client'

import { useEffect, useMemo, useState } from 'react'

/** Keep expensive screen-space lane comparisons off the map's input thread. */
export function useSeparatedPaths(paths: number[][][], zoom: number, tileSize: number): number[][][] {
    const geometry = useMemo(() => JSON.stringify(paths), [paths])
    const stablePaths = useMemo<number[][][]>(() => JSON.parse(geometry), [geometry])
    const bucket = Math.round(zoom * 2) / 2
    const [result, setResult] = useState<{ geometry: string; tileSize: number; paths: number[][][] } | null>(null)
    useEffect(() => {
        if (stablePaths.length < 2) return
        let worker: Worker | undefined
        let cancelled = false
        // Coalesce wheel bursts; a superseded job is terminated, never queued.
        const timer = setTimeout(() => {
            try {
                worker = new Worker(new URL('./route-separation.worker.ts', import.meta.url))
                worker.onmessage = (event: MessageEvent<number[][][]>) => {
                    if (!cancelled) setResult({ geometry, tileSize, paths: event.data })
                    worker?.terminate()
                }
                worker.onerror = () => worker?.terminate()
                worker.postMessage({ paths: stablePaths, zoom: bucket, tileSize })
            } catch { worker?.terminate() }
        }, 80)
        return () => { cancelled = true; clearTimeout(timer); worker?.terminate() }
    }, [geometry, stablePaths, bucket, tileSize])
    // While zooming, keep the previous lanes; changed geometry uses its own raw paths.
    return result?.geometry === geometry && result.tileSize === tileSize ? result.paths : stablePaths
}
