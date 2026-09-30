'use client'

import { useEffect, useRef } from 'react'

/** Keep keyboard focus in the top dialog without opening the mobile keyboard. */
export function useDialogFocus(open: boolean, onClose: () => void, busy = false) {
    const ref = useRef<HTMLDivElement>(null)
    const options = useRef({ onClose, busy })
    options.current = { onClose, busy }
    useEffect(() => {
        if (!open) return
        const previous = document.activeElement as HTMLElement | null
        const dialog = ref.current
        if (!dialog) return
        const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [contenteditable="true"], [tabindex="0"]',
        )).filter(element => element.getClientRects().length > 0)
        dialog.focus({ preventScroll: true })
        const handle = (event: KeyboardEvent) => {
            const dialogs = document.querySelectorAll('[role="dialog"]')
            if (dialogs[dialogs.length - 1] !== dialog) return
            if (event.key === 'Escape') {
                event.preventDefault()
                if (!options.current.busy) options.current.onClose()
            }
            if (event.key !== 'Tab') return
            const items = elements(), first = items[0], last = items[items.length - 1]
            if (!first) { event.preventDefault(); dialog.focus(); return }
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement) || document.activeElement === dialog)) {
                event.preventDefault(); last.focus()
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault(); first.focus()
            }
        }
        document.addEventListener('keydown', handle)
        return () => {
            document.removeEventListener('keydown', handle)
            if (previous?.isConnected) previous.focus({ preventScroll: true })
        }
    }, [open])
    return ref
}
