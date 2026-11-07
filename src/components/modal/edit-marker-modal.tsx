'use client'

import type { Marker, MarkerIconType } from '@/types/marker'
import { PlaceEditorDialog } from './place-editor-dialog'
import { TripNoteEditor } from '@/components/trips/trip-note-editor'
import { useMapStore } from '@/store/map-store'

interface EditMarkerModalProps {
    marker: Marker | null
    isOpen: boolean
    onClose: () => void
    onSave: (data: {
        markerId: string
        title?: string
        headerImage?: string
        markdownContent: string
        iconType?: MarkerIconType
    }) => Promise<void>
}

export function EditMarkerModal({ marker, isOpen, onClose, onSave }: EditMarkerModalProps) {
    const trip = useMapStore(state => state.trips.find(trip => trip.id === state.editMarkerModal.tripId))
    if (!isOpen || !marker) return null
    if (trip) return <TripNoteEditor key={`${trip.id}:${marker.id}`} trip={trip} marker={marker} onClose={onClose} />
    return <PlaceEditorDialog key={marker.id} title="编辑地点" address={marker.content.address} initial={{ title: marker.content.title || '', iconType: marker.content.iconType || 'location', headerImage: marker.content.headerImage || '', markdownContent: marker.content.markdownContent || '' }} onClose={onClose} onSave={values => onSave({ markerId: marker.id, title: values.title, iconType: values.iconType, headerImage: values.headerImage || undefined, markdownContent: values.markdownContent })} />
}
