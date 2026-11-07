'use client'

import React from 'react'

import { useState } from 'react'
import { useMapStore } from '@/store/map-store'
import { PlaceEditorDialog } from '@/components/modal/place-editor-dialog'
import type { Marker } from '@/types/marker'
import type { Trip } from '@/types/trip'

export function TripNoteEditor({ marker, trip, onClose }: { marker: Marker; trip: Trip; onClose: () => void }) {
    // Freeze identity and revision for the entire editing session, including view changes.
    const [target] = useState(() => ({ tripId: trip.id, tripName: trip.name, markerId: marker.id,
        note: trip.markerNotes?.find(note => note.markerId === marker.id) }))
    return <PlaceEditorDialog title="编辑本次旅行笔记" tripNote={{ tripName: target.tripName, placeName: marker.content.title || '未命名地点' }}
        initial={{ title: target.note?.title || '', markdownContent: target.note?.content || '', headerImage: '', iconType: 'location' }}
        onClose={onClose} onSave={values => useMapStore.getState().saveTripMarkerNote(target.tripId, target.markerId, {
            title: values.title, content: values.markdownContent, expectedUpdatedAt: target.note?.updatedAt ?? null,
        })} />
}
