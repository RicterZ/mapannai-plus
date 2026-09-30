/** Run visual animation only while the page is visible and motion is allowed. */
export function startAnimationLoop(update: (time: number) => void, clear?: () => void) {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const tick = (time: number) => {
        update(time)
        frame = requestAnimationFrame(tick)
    }
    const sync = () => {
        cancelAnimationFrame(frame)
        frame = 0
        if (motion.matches) clear?.()
        else if (!document.hidden) frame = requestAnimationFrame(tick)
    }
    document.addEventListener('visibilitychange', sync)
    motion.addEventListener('change', sync)
    sync()
    return () => {
        cancelAnimationFrame(frame)
        document.removeEventListener('visibilitychange', sync)
        motion.removeEventListener('change', sync)
        clear?.()
    }
}
