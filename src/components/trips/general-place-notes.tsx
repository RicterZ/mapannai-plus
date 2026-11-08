'use client'

import React, { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PlaceIcon } from '@/components/ui/place-icon'
import { generalImage } from '@/lib/trips/place-image'
import { noteExcerpt } from '@/lib/trips/note-excerpt'
import { compressedContentImages, compressedImageUrl } from '@/lib/upload/image-url'
import { MARKER_ICONS, type Marker } from '@/types/marker'
import { cn } from '@/utils/cn'

// The user's explicit expand/collapse choice lasts for this page session.
let rememberedOpen: boolean | null = null

/** Shared place notes under a trip note: collapsed to one row unless the trip note is empty. */
export function GeneralPlaceNotes({ marker, tripNoteEmpty }: { marker: Marker; tripNoteEmpty: boolean }) {
    const [open, setOpen] = useState(rememberedOpen ?? tripNoteEmpty)
    useEffect(() => { setOpen(rememberedOpen ?? tripNoteEmpty) }, [marker.id, tripNoteEmpty])
    const content = marker.content.markdownContent || ''
    const cover = generalImage(marker)
    const excerpt = noteExcerpt(content)
    const icon = MARKER_ICONS[marker.content.iconType || 'location'] || MARKER_ICONS.location
    if (!content && !cover) return <section className="border-t border-gray-100 pt-4" aria-label="地点通用笔记"><p className="text-xs text-gray-400">还没有通用笔记</p></section>
    return <section className="border-t border-gray-100 pt-3" aria-label="地点通用笔记">
        <button type="button" aria-expanded={open} onClick={() => { rememberedOpen = !open; setOpen(!open) }} className="flex w-full items-center gap-3 rounded-lg py-1 text-left">
            {!open && (cover
                ? <img src={compressedImageUrl(cover)} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />
                : <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-50"><PlaceIcon emoji={icon.emoji} size={22} /></span>)}
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-5 text-gray-800">通用笔记</span>
                {!open && excerpt && <span className="mt-0.5 block truncate text-xs leading-4 text-gray-400">{excerpt}</span>}
            </span>
            <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
        </button>
        {open && <div className="mt-3 space-y-3">
            {cover && <img src={compressedImageUrl(cover)} alt={`${marker.content.title || '地点'}通用封面`} loading="lazy" className="aspect-video w-full rounded-2xl object-cover" />}
            {content && <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }} />}
        </div>}
    </section>
}
