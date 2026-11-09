'use client'

import React from 'react'
import { useMapStore } from '@/store/map-store'
import { compressedContentImages } from '@/lib/upload/image-url'
import { hasNoteContent } from '@/lib/trips/note-excerpt'
import { PlaceIcon } from '@/components/ui/place-icon'
import type { Marker } from '@/types/marker'

export function TripPlaceNotes({ marker, tripId }: { marker: Marker; tripId: string | null }) {
    const trip = useMapStore(state => state.trips.find(trip => trip.id === tripId))
    const note = trip?.markerNotes?.find(note => note.markerId === marker.id)
    const raw = trip ? note?.content : marker.content.markdownContent
    const content = hasNoteContent(raw) ? raw! : ''
    const body = content ? <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }} /> : null
    if (!trip) return <section className="space-y-3" aria-label="地点通用笔记">{body ?? <p className="text-xs text-gray-400">还没有通用笔记</p>}</section>
    return <section className="border-t border-gray-100 pt-4" aria-label="本次旅行笔记">
        <h3 className="text-xs font-medium text-gray-400">行程笔记</h3>
        <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-1 pr-2.5 text-xs leading-5 text-slate-600">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white shadow-[0_0_0_1px_#e2e8f0]"><PlaceIcon emoji={trip.emoji || '✈️'} size={12} /></span>
            <span className="truncate">{trip.name}</span>
        </span>
        {note?.title || body ? <div className="mt-3 space-y-3">
            {note?.title && <h4 className="break-words text-lg font-semibold">{note.title}</h4>}
            {body}
        </div> : <p className="mt-2 text-xs leading-4 text-gray-400">这次旅行还没有笔记，可点右上角编辑添加</p>}
    </section>
}
