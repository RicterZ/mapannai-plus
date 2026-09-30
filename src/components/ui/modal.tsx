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
        const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') || [])
        ;(focusable()[0] || ref.current)?.focus()
        const handle = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); if (!busyRef.current) closeRef.current() }
            if (event.key !== 'Tab') return
            const elements = focusable(), first = elements[0], last = elements[elements.length - 1]
            if (!first) { event.preventDefault(); ref.current?.focus(); return }
            if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', handle)
        return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
    }, [])
    return createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl outline-none">
            <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
            {children}
        </div>
    </div>, document.body)
}
