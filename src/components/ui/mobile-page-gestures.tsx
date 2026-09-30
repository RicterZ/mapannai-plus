'use client'

import { useEffect } from 'react'

// Safari may ignore the viewport scale limit. Prevent its native page gesture
// without stopping touch/pointer events used by the map SDK for map zooming.
export function MobilePageGestures() {
    useEffect(() => {
        const preventPageZoom = (event: Event) => {
            if (window.matchMedia('(pointer: coarse)').matches && event.cancelable) event.preventDefault()
        }
        document.addEventListener('gesturestart', preventPageZoom, { passive: false })
        document.addEventListener('gesturechange', preventPageZoom, { passive: false })
        return () => {
            document.removeEventListener('gesturestart', preventPageZoom)
            document.removeEventListener('gesturechange', preventPageZoom)
        }
    }, [])
    return null
}
