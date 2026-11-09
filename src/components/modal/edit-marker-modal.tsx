'use client'

import React, { useState } from 'react'
import type { Marker, MarkerIconType } from '@/types/marker'
import { PlaceEditorDialog, type PlaceEditorValues } from './place-editor-dialog'
import { useMapStore } from '@/store/map-store'
import { placeMemberships } from '@/lib/trips/place-memberships'
import { cn } from '@/utils/cn'
import { hasNoteContent } from '@/lib/trips/note-excerpt'

const sameValues = (a: PlaceEditorValues, b: PlaceEditorValues) => a.title.trim() === b.title.trim() && a.iconType === b.iconType && a.headerImage === b.headerImage
    && (a.markdownContent === b.markdownContent || (!hasNoteContent(a.markdownContent) && !hasNoteContent(b.markdownContent)))

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
    const initialFor = (id: string | null): PlaceEditorValues => {
        if (!id) return shared
        const saved = snapshot.get(id)
        return { title: saved?.title || '', markdownContent: saved?.content || '', iconType: 'location', headerImage: saved?.headerImage || '' }
    }
    const initial = initialFor(scope)
    const [baselines, setBaselines] = useState<Record<string, PlaceEditorValues>>({})
    const values = drafts[key] ?? initial
    const choices = memberships.map(({ trip }) => ({ id: trip.id as string | null, label: trip.name }))
    if (trip && !choices.some(choice => choice.id === trip.id)) choices.push({ id: trip.id, label: trip.name })
    return <PlaceEditorDialog key={key} title="编辑地点" address={marker.content.address} initial={initial}
        tripNote={scope ? { tripName: trip?.name || '本次旅行', placeName: marker.content.title || '未命名地点' } : undefined}
        scopeEditor={{ values, onChange: next => setDrafts(current => ({ ...current, [key]: next })), navigation: <nav aria-label="选择编辑内容" className="space-y-2 border-b border-gray-200 pb-4">
            {[{ id: null, label: '通用资料' }, ...choices].map(choice => <button key={choice.id ?? 'shared'} type="button" aria-pressed={scope === choice.id}
                onClick={() => setScope(choice.id)} className={cn('block min-h-[44px] w-full rounded-xl border px-3 py-2 text-left text-sm', scope === choice.id ? 'border-blue-300 bg-blue-50 text-gray-900' : 'border-gray-200 bg-white text-gray-600')}>{choice.label}</button>)}
        </nav> }} saveLabel="保存地点" onClose={onClose} onSave={async next => {
            const all = { ...drafts, [key]: next }
            setDrafts(all)
            // General first so a trip-note failure still leaves the shared edit saved; each saved scope becomes its new baseline.
            const pending = Object.keys(all).sort((a, b) => (a === 'shared' ? -1 : b === 'shared' ? 1 : 0))
                .filter(id => !sameValues(all[id], baselines[id] ?? initialFor(id === 'shared' ? null : id)))
            for (const id of pending) {
                const values = { ...all[id], title: all[id].title.trim() }
                if (id === 'shared') {
                    if (!values.title) { setScope(null); throw new Error('请输入地点名称') }
                    await onSave({ markerId: marker.id, ...values, headerImage: values.headerImage || undefined })
                } else {
                    try {
                        await saveTripMarkerNote(id, marker.id, { title: values.title, content: values.markdownContent, headerImage: values.headerImage || null, expectedUpdatedAt: revisions[id] ?? null })
                    } catch (cause) {
                        setScope(id)
                        throw new Error(`${trips.find(trip => trip.id === id)?.name || '行程'}的笔记保存失败：${cause instanceof Error ? cause.message : '请重试'}`)
                    }
                    const saved = useMapStore.getState().trips.find(trip => trip.id === id)?.markerNotes?.find(note => note.markerId === marker.id)
                    setRevisions(current => ({ ...current, [id]: saved?.updatedAt ?? null }))
                }
                setBaselines(current => ({ ...current, [id]: values }))
            }
            onClose()
        }} />
}

export function EditMarkerModal({ marker, isOpen, onClose, onSave }: { marker: Marker | null; isOpen: boolean; onClose: () => void; onSave: Save }) {
    if (!isOpen || !marker) return null
    return <PlaceEditingSession key={marker.id} marker={marker} onClose={onClose} onSave={onSave} />
}
