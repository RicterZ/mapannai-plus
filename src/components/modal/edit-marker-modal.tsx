'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Marker, MarkerIconType } from '@/types/marker'
import { uploadFileToS3 } from '@/lib/upload/direct-upload'
import { compressedImageUrl } from '@/lib/upload/image-url'
import { IconSelector } from '@/components/ui/icon-selector'
import { RichEditor } from '@/components/ui/rich-editor'

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
    }) => void
}

export const EditMarkerModal = ({ marker, isOpen, onClose, onSave }: EditMarkerModalProps) => {
    const [title, setTitle] = useState('')
    const [headerImage, setHeaderImage] = useState('')
    const [htmlContent, setHtmlContent] = useState('')
    const [iconType, setIconType] = useState<MarkerIconType>('location')
    const [isUploading, setIsUploading] = useState(false)

    // 仅在 modal 打开瞬间初始化一次，避免后台数据刷新时覆盖编辑中的内容
    const initializedRef = useRef<string | null>(null)
    useEffect(() => {
        if (marker && isOpen && initializedRef.current !== marker.id) {
            initializedRef.current = marker.id
            setTitle(marker.content.title || '')
            setHeaderImage(marker.content.headerImage || '')
            setIconType((marker.content.iconType as MarkerIconType) || 'location')
            setHtmlContent(marker.content.markdownContent || '')
        }
        if (!isOpen) {
            initializedRef.current = null
        }
    }, [marker?.id, isOpen])

    if (!isOpen || !marker) return null

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return
        setIsUploading(true)
        try {
            const result = await uploadFileToS3(file)
            if (result.success && result.url) {
                setHeaderImage(result.url)
            } else {
                toast.error('图片上传失败: ' + result.error)
            }
        } catch {
            toast.error('图片上传失败')
        } finally {
            setIsUploading(false)
            event.target.value = ''
        }
    }

    const handleSave = () => {
        if (!marker) return
        onSave({
            markerId: marker.id,
            title: title.trim() || undefined,
            headerImage: headerImage || undefined,
            markdownContent: htmlContent,
            iconType,
        })
        toast.success('已保存')
        onClose()
    }

    const handleCancel = () => {
        if (marker) {
            setTitle(marker.content.title || '')
            setHeaderImage(marker.content.headerImage || '')
            setHtmlContent(marker.content.markdownContent || '')
            setIconType((marker.content.iconType as MarkerIconType) || 'location')
        }
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center lg:p-4">
            <div className="absolute inset-0" onClick={handleCancel} />

            <div className="relative w-full h-full lg:w-[760px] lg:h-[640px] bg-white flex flex-col animate-slide-in-bottom lg:animate-fade-in lg:rounded-xl lg:shadow-2xl overflow-hidden">

                {/* ── Header ──────────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-blue-50 flex-shrink-0 edit-marker-header">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900">编辑标记</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            保存
                        </button>
                        <button
                            onClick={handleCancel}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── Meta fields ─────────────────────────────────────────── */}
                <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 space-y-3">
                    <div className="flex gap-3 items-center">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            placeholder="标记标题"
                        />
                        <div className="flex-shrink-0">
                            <IconSelector selectedIcon={iconType} onSelect={setIconType} />
                        </div>
                    </div>

                    {/* Header image */}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="edit-header-image" />
                    {!headerImage ? (
                        <label
                            htmlFor="edit-header-image"
                            className="flex items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-white hover:border-blue-300 transition-colors"
                        >
                            {isUploading ? (
                                <svg className="w-6 h-6 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            ) : (
                                <div className="flex items-center gap-2 text-sm text-gray-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    点击上传封面图
                                </div>
                            )}
                        </label>
                    ) : (
                        <div className="relative group w-full h-24">
                            <img src={compressedImageUrl(headerImage)} alt="封面" className="w-full h-full object-cover rounded-lg" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all rounded-lg flex items-center justify-center gap-2">
                                <label
                                    htmlFor="edit-header-image"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-1.5 bg-white rounded-full shadow"
                                    title="更换图片"
                                >
                                    <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setHeaderImage('')}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-white rounded-full shadow"
                                    title="删除图片"
                                >
                                    <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Rich editor ─────────────────────────────────────────── */}
                <div className="flex-1 overflow-hidden">
                    <RichEditor
                        content={htmlContent}
                        onChange={setHtmlContent}
                    />
                </div>
            </div>
        </div>
    )
}
