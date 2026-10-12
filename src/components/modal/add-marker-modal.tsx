'use client'

import type { PlaceReferences } from '@/types/place-references'
import type { MarkerCoordinates, MarkerIconType } from '@/types/marker'
import { PlaceEditorDialog } from './place-editor-dialog'

interface AddMarkerModalProps {
    coordinates: MarkerCoordinates
    placeReferences?: PlaceReferences
    isOpen: boolean
    onClose: () => void
    onSave: (data: {
        coordinates: MarkerCoordinates
        name: string
        iconType: MarkerIconType
        placeReferences?: PlaceReferences
        address?: string
        headerImage?: string
        markdownContent: string
    }) => Promise<void>
    placeName?: string
    placeAddress?: string
}

export function AddMarkerModal({ coordinates, isOpen, onClose, onSave, placeName, placeAddress, placeReferences }: AddMarkerModalProps) {
    if (!isOpen) return null
    return <PlaceEditorDialog title="添加地点" address={placeAddress} initial={{ title: placeName || '', iconType: 'location', headerImage: '', markdownContent: '' }} onClose={onClose} onSave={values => onSave({ coordinates, name: values.title, iconType: values.iconType, address: placeAddress, placeReferences, headerImage: values.headerImage || undefined, markdownContent: values.markdownContent })} />
}
