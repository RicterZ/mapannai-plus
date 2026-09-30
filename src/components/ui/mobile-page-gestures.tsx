'use client'

import { useEffect } from 'react'

// Safari may ignore the viewport scale limit. Prevent its native page gesture
// without stopping touch/pointer events used by the map SDK for map zooming.
export function MobilePageGestures() {
    useEffect(() => {
        const preventPageZoom = (event: Event) => {
            if (window.matchMedia('(pointer: coarse)').matches && event.cancelable) event.preventDefault()
        }
        // Only dialogs follow the visual viewport; the map keeps its full canvas.
        const viewport = window.visualViewport
        let frame = 0
        const updateViewport = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                document.documentElement.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
                document.documentElement.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`)
            })
        }
        updateViewport()
        viewport?.addEventListener('resize', updateViewport)
        viewport?.addEventListener('scroll', updateViewport)
        window.addEventListener('resize', updateViewport)
        document.addEventListener('gesturestart', preventPageZoom, { passive: false })
        document.addEventListener('gesturechange', preventPageZoom, { passive: false })
        return () => {
            cancelAnimationFrame(frame)
            viewport?.removeEventListener('resize', updateViewport)
            viewport?.removeEventListener('scroll', updateViewport)
            window.removeEventListener('resize', updateViewport)
            document.documentElement.style.removeProperty('--dialog-viewport-height')
            document.documentElement.style.removeProperty('--dialog-viewport-top')
            document.removeEventListener('gesturestart', preventPageZoom)
            document.removeEventListener('gesturechange', preventPageZoom)
        }
    }, [])
    return null
}
