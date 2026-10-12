'use client'

import { useId, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useDialogFocus } from '@/lib/ui/use-dialog-focus'
import { uploadFileToS3 } from '@/lib/upload/direct-upload'
import { compressedImageUrl } from '@/lib/upload/image-url'
import { IconSelector } from '@/components/ui/icon-selector'
import { RichEditor } from '@/components/ui/rich-editor'
import type { MarkerIconType } from '@/types/marker'

export interface PlaceEditorValues {
    title: string
    iconType: MarkerIconType
    headerImage: string
    markdownContent: string
}

export function PlaceEditorDialog({ title, address, initial, onClose, onSave }: {
    title: string
    address?: string
    initial: PlaceEditorValues
    onClose: () => void
    onSave: (values: PlaceEditorValues) => Promise<void>
}) {
    const [values, setValues] = useState(initial)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [bodyUploading, setBodyUploading] = useState(false)
    const [error, setError] = useState('')
    const uploadId = useId()
    const busy = saving || uploading || bodyUploading
    const close = () => { if (!busy) onClose() }
    const dialogRef = useDialogFocus(true, close, busy)
    const save = async () => {
        if (busy) return
        if (!values.title.trim()) { setError('请输入地点名称'); return }
        setSaving(true)
        setError('')
        try {
            await onSave({ ...values, title: values.title.trim() })
            toast.success('地点已保存')
            onClose()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '保存失败，请重试')
        } finally { setSaving(false) }
    }
    return <div className="fixed inset-0 modal-viewport z-[100] flex items-center justify-center bg-black/30 p-4" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="dialog-card place-editor-dialog flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                <button type="button" disabled={busy} onClick={close} aria-label="关闭" className="workspace-icon-button"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden">
                <fieldset disabled={busy} className="min-w-0 space-y-5 border-b border-gray-100 bg-gray-50/60 p-5 lg:w-[280px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                    <label className="block text-xs font-medium text-gray-500">地点名称<input value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} className="workspace-field mt-2" placeholder="给这个地点起个名字" /></label>
                    {address && <p className="text-xs leading-5 text-gray-500">{address}</p>}
                    <div><span className="mb-2 block text-xs font-medium text-gray-500">分类</span><IconSelector selectedIcon={values.iconType} onSelect={iconType => setValues({ ...values, iconType })} /></div>
                    <div>
                        <span className="mb-2 block text-xs font-medium text-gray-500">封面</span>
                        <input id={uploadId} disabled={busy} type="file" accept="image/*" className="hidden" onChange={async event => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            if (!file) return
                            setUploading(true)
                            setError('')
                            try {
                                const result = await uploadFileToS3(file)
                                if (!result.success || !result.url) throw new Error(result.error || '图片上传失败')
                                setValues(current => ({ ...current, headerImage: result.url! }))
                            } catch (cause) { setError(cause instanceof Error ? cause.message : '图片上传失败') }
                            finally { setUploading(false) }
                        }} />
                        {values.headerImage ? <div className="space-y-2">
                            <img src={compressedImageUrl(values.headerImage)} alt="地点封面" className="h-32 w-full rounded-xl object-cover" />
                            <div className="flex items-center justify-between text-xs text-gray-500"><label htmlFor={uploadId} className="cursor-pointer rounded-lg px-2 py-2 hover:bg-gray-100">更换封面</label><button type="button" onClick={() => setValues({ ...values, headerImage: '' })} className="rounded-lg px-2 py-2 hover:bg-gray-100">移除</button></div>
                        </div> : <label htmlFor={uploadId} className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white text-xs text-gray-400 hover:border-gray-400"><ImagePlus size={22} />{uploading ? '上传中…' : '添加封面'}</label>}
                    </div>
                </fieldset>
                <div className="flex min-h-[300px] min-w-0 flex-1 flex-col lg:min-h-0">
                    <div className="px-5 pt-4 pb-2 text-xs font-medium text-gray-500">地点笔记</div>
                    <div className={`min-h-0 flex-1 ${busy ? 'pointer-events-none opacity-60' : ''}`} aria-busy={busy}>
                        <RichEditor editable={!busy} onUploadingChange={setBodyUploading} content={values.markdownContent} onChange={markdownContent => setValues(current => ({ ...current, markdownContent }))} placeholder="记录想做的事、地址提示或旅行攻略…" />
                    </div>
                </div>
            </div>
            <div className="shrink-0 border-t border-gray-100 px-5 py-4">
                {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2"><button disabled={busy} onClick={close} className="workspace-secondary-button">取消</button><button disabled={busy} onClick={() => void save()} className="workspace-primary-button">{saving ? '保存中…' : uploading || bodyUploading ? '上传中…' : '保存地点'}</button></div>
            </div>
        </div>
    </div>
}
