'use client'

import type { PlaceReferences } from '@/types/place-references'

import { useDialogFocus } from '@/lib/ui/use-dialog-focus'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { MarkerCoordinates, MarkerIconType } from '@/types/marker'
import { IconSelector } from '@/components/ui/icon-selector'

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
    }) => void
    placeName?: string  // 添加地点名称参数
    placeAddress?: string  // 添加地址参数
}

export const AddMarkerModal = ({ coordinates, isOpen, onClose, onSave, placeName, placeAddress, placeReferences }: AddMarkerModalProps) => {
    const [name, setName] = useState('')
    const [iconType, setIconType] = useState<MarkerIconType>('location')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // 当模态框打开且有地点名称时，自动填写
    useEffect(() => {
        if (isOpen && placeName) {
            setName(placeName)
        }
    }, [isOpen, placeName])

    const dialogRef = useDialogFocus(isOpen, onClose, isSubmitting)

    if (!isOpen) return null

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('请输入地点名称')
            return
        }

        setIsSubmitting(true)
        try {
            await onSave({
                coordinates,
                name: name.trim(),
                iconType,
                address: placeAddress,
                placeReferences,
            })

            toast.success('标记已创建')
            // 重置表单并关闭模态框
            setName('')
            setIconType('location')
            onClose()
        } catch (error) {
            console.error('保存失败:', error)
            toast.error('保存失败，请重试')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleCancel = () => {
        setName('')
        setIconType('location')
        onClose()
    }

    return (
        <div className="fixed inset-0 modal-viewport bg-black/40 flex items-center justify-center z-[100] p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="添加新地点" tabIndex={-1} className="dialog-card outline-none bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-full overflow-y-auto animate-scale-in">
                {/* 头部区域 */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">添加新地点</h2>
                            </div>
                        </div>
                        <button
                            aria-label="关闭"
                            onClick={handleCancel}
                            className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors duration-200"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* 内容区域 */}
                <div className="p-4 space-y-4">
                    {/* 位置信息 */}
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                        {placeAddress ? (
                            <div className="space-y-1">
                                <p className="text-xs text-gray-600 leading-relaxed">{placeAddress}</p>
                                <p className="text-xs text-gray-400 font-mono">
                                    {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                <p className="text-xs text-gray-400 font-mono">
                                    {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 地点名称 */}
                    <div className="space-y-1.5">
                        <label className="block text-sm font-semibold text-gray-800">
                            地点名称
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-sm h-10"
                            placeholder="请输入地点名称"
                        />
                    </div>

                    {/* 图标选择 */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-800">
                            选择图标
                        </label>
                        <IconSelector
                            selectedIcon={iconType}
                            onSelect={setIconType}
                        />
                    </div>
                </div>

                {/* 底部按钮 */}
                <div className="flex gap-3 p-4 bg-gray-50 border-t border-gray-200">
                    <button
                        onClick={handleCancel}
                        className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors duration-200 font-medium focus:outline-none"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-medium shadow-md focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                创建中...
                            </>
                        ) : '创建标记'}
                    </button>
                </div>
            </div>
        </div>
    )
} 