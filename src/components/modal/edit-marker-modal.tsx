'use client'

import React, { useState } from 'react'
import type { Marker, MarkerIconType } from '@/types/marker'
import { PlaceEditorDialog, type PlaceEditorValues } from './place-editor-dialog'
import { useMapStore } from '@/store/map-store'
import { placeMemberships } from '@/lib/trips/place-memberships'
import { cn } from '@/utils/cn'

type Save = (data: { markerId: string; title?: string; headerImage?: string; markdownContent: string; iconType?: MarkerIconType }) => Promise<void>

function PlaceEditingSession({ marker, onClose, onSave }: { marker: Marker; onClose: () => void; onSave: Save }) {
    const { trips, tripDays, editMarkerModal, saveTripMarkerNote } = useMapStore()
    const memberships = placeMemberships(marker.id, trips, tripDays)
    const [scope, setScope] = useState<string | null>(editMarkerModal.tripId ?? null)
    const [drafts, setDrafts] = useState<Record<string, PlaceEditorValues>>({})
    // Snapshot every scope once: a background refresh must not replace a draft or its revision.
    const [snapshot] = useState(() => new Map(trips.map(trip => [trip.id, trip.markerNotes?.find(note => note.markerId === marker.id)])))
    const [revisions, setRevisions] = useState(() => Object.fromEntries(trips.map(trip => [trip.id, trip.markerNotes?.find(note => note.markerId === marker.id)?.updatedAt ?? null])))
    const [shared] = useState<PlaceEditorValues>({ title: marker.content.title || '', iconType: marker.content.iconType || 'location', headerImage: marker.content.headerImage || '', markdownContent: marker.content.markdownContent || '' })
    const key = scope ?? 'shared'
    const trip = trips.find(trip => trip.id === scope)
    const note = scope ? snapshot.get(scope) : undefined
    const initial: PlaceEditorValues = scope ? { title: note?.title || '', markdownContent: note?.content || '', iconType: 'location', headerImage: '' } : shared
    const values = drafts[key] ?? initial
    const choices = memberships.map(({ trip }) => ({ id: trip.id as string | null, label: trip.name }))
    if (trip && !choices.some(choice => choice.id === trip.id)) choices.push({ id: trip.id, label: trip.name })
    return <PlaceEditorDialog key={key} title="编辑地点" address={marker.content.address} initial={initial}
        tripNote={scope ? { tripName: trip?.name || '本次旅行', placeName: marker.content.title || '未命名地点' } : undefined}
        scopeEditor={{ values, onChange: next => setDrafts(current => ({ ...current, [key]: next })), navigation: <nav aria-label="选择编辑内容" className="space-y-2 border-b border-gray-200 pb-4">
            {[{ id: null, label: '通用资料' }, ...choices].map(choice => <button key={choice.id ?? 'shared'} type="button" aria-pressed={scope === choice.id}
                onClick={() => setScope(choice.id)} className={cn('block min-h-[44px] w-full rounded-xl border px-3 py-2 text-left text-sm', scope === choice.id ? 'border-blue-300 bg-blue-50 text-gray-900' : 'border-gray-200 bg-white text-gray-600')}>{choice.label}</button>)}
        </nav> }} onClose={onClose} onSave={async next => {
            if (scope) {
                await saveTripMarkerNote(scope, marker.id, { title: next.title, content: next.markdownContent, expectedUpdatedAt: revisions[scope] ?? null })
                const saved = useMapStore.getState().trips.find(trip => trip.id === scope)?.markerNotes?.find(note => note.markerId === marker.id)
                setRevisions(current => ({ ...current, [scope]: saved?.updatedAt ?? null }))
            } else await onSave({ markerId: marker.id, ...next, headerImage: next.headerImage || undefined })
            setDrafts(current => ({ ...current, [key]: next }))
        }} />
}

export function EditMarkerModal({ marker, isOpen, onClose, onSave }: { marker: Marker | null; isOpen: boolean; onClose: () => void; onSave: Save }) {
    if (!isOpen || !marker) return null
    return <PlaceEditingSession key={marker.id} marker={marker} onClose={onClose} onSave={onSave} />
}
