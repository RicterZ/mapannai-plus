'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    const closeRef = useRef(onClose)
    const busyRef = useRef(busy)
    closeRef.current = onClose
    busyRef.current = busy
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex="0"]') || [])
        ;(focusable()[0] || ref.current)?.focus({ preventScroll: true })
        const handle = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); if (!busyRef.current) closeRef.current() }
            if (event.key !== 'Tab') return
            const elements = focusable(), first = elements[0], last = elements[elements.length - 1]
            if (!first) { event.preventDefault(); ref.current?.focus({ preventScroll: true }); return }
            if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', handle)
        return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
    }, [])
    return createPortal(<div className="fixed inset-0 modal-viewport z-[200] flex items-center justify-center bg-black/30 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="dialog-card animate-scale-in max-h-full w-full max-w-[480px] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl outline-none">
            <div className="mb-5 flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-gray-900">{title}</h3><button type="button" disabled={busy} onClick={onClose} aria-label="关闭" className="workspace-icon-button"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
            {children}
        </div>
    </div>, document.body)
}
