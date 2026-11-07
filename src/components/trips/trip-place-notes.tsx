'use client'

import React from 'react'

import { useState } from 'react'
import { toast } from 'sonner'
import { useMapStore } from '@/store/map-store'
import { compressedContentImages } from '@/lib/upload/image-url'
import { PlaceEditorDialog } from '@/components/modal/place-editor-dialog'
import { TripNoteEditor } from './trip-note-editor'
import type { Marker } from '@/types/marker'

export function TripPlaceNotes({ marker }: { marker: Marker }) {
    const { trips, activeView, editMode, setActiveView, openLeftSidebar, saveTripMarkerNote, updateMarkerFromModal } = useMapStore()
    const [editor, setEditor] = useState<'trip' | 'shared' | null>(null)
    const [copying, setCopying] = useState(false)
    const trip = trips.find(trip => trip.id === activeView.tripId)
    const note = trip?.markerNotes?.find(note => note.markerId === marker.id)
    const shared = marker.content.markdownContent || ''
    const sharedBody = <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(shared) }} />
    return <>
        {trip && <section className="space-y-3" aria-label="本次旅行笔记">
            <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium text-gray-500">本次旅行 · {trip.name}</h3>
                {editMode.isEnabled && <button className="workspace-secondary-button" onClick={() => setEditor('trip')}>{note ? '编辑本次笔记' : '添加本次笔记'}</button>}</div>
            {note?.title && <h4 className="break-words text-lg font-semibold">{note.title}</h4>}
            {note?.content && <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(note.content) }} />}
            {!note && <p className="text-xs text-gray-400">还没有本次旅行笔记</p>}
            {editMode.isEnabled && !note?.content && shared && <button disabled={copying} className="workspace-secondary-button" onClick={async () => {
                setCopying(true)
                try { await saveTripMarkerNote(trip.id, marker.id, { expectedUpdatedAt: note?.updatedAt ?? null }, true); toast.success('已复制到本次旅行，通用笔记仍保留') }
                catch (error) { toast.error(error instanceof Error ? error.message : '复制失败') }
                finally { setCopying(false) }
            }}>{copying ? '复制中…' : '复制通用笔记到本次旅行'}</button>}
        </section>}
        <section className="space-y-3" aria-label="地点通用笔记">
            <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium text-gray-500">地点通用笔记 · 所有旅行共享</h3>
                {editMode.isEnabled && <button className="workspace-secondary-button" onClick={() => setEditor('shared')}>编辑通用资料</button>}</div>
            {shared ? trip ? <details><summary className="cursor-pointer text-xs text-gray-500">展开通用攻略</summary><div className="pt-3">{sharedBody}</div></details> : sharedBody : <p className="text-xs text-gray-400">还没有通用笔记</p>}
        </section>
        {trips.some(other => other.id !== trip?.id && other.markerNotes?.some(note => note.markerId === marker.id)) && <details className="space-y-2"><summary className="cursor-pointer text-xs text-gray-500">历次旅行笔记</summary>
            {trips.filter(other => other.id !== trip?.id && other.markerNotes?.some(note => note.markerId === marker.id)).map(other => <button key={other.id} className="block min-h-[44px] w-full text-left text-sm text-gray-600" onClick={() => { setActiveView('trip', other.id, null, { focusFirstMarker: false }); openLeftSidebar() }}>{other.name}</button>)}
        </details>}
        {editor === 'trip' && trip && <TripNoteEditor trip={trip} marker={marker} onClose={() => setEditor(null)} />}
        {editor === 'shared' && <PlaceEditorDialog title="编辑地点通用资料 · 所有旅行共享" initial={{ title: marker.content.title || '', markdownContent: shared, headerImage: marker.content.headerImage || '', iconType: marker.content.iconType || 'location' }} onClose={() => setEditor(null)}
            onSave={values => updateMarkerFromModal({ markerId: marker.id, ...values, headerImage: values.headerImage || undefined })} />}
    </>
}
