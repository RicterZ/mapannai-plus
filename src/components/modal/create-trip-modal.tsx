'use client'

import { PlaceIcon } from '@/components/ui/place-icon'

import { useDialogFocus } from '@/lib/ui/use-dialog-focus'

import { DestinationPicker } from '@/components/trips/destination-picker'
import type { TripDestination } from '@/types/trip'
import { useState } from 'react'
import { toast } from 'sonner'
import { useMapStore } from '@/store/map-store'

interface CreateTripModalProps {
    isOpen: boolean
    onClose: () => void
    onCreated?: (tripId: string) => void
}

export const CreateTripModal = ({ isOpen, onClose, onCreated }: CreateTripModalProps) => {
    const { createTrip, setActiveView } = useMapStore()
    const [destinations, setDestinations] = useState<TripDestination[]>([])
    const [name, setName] = useState('')
    const [startDate, setStartDate] = useState('')
    const [duration, setDuration] = useState<string>('3')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const dialogRef = useDialogFocus(isOpen, onClose, isSubmitting)

    if (!isOpen) return null

    const durationNum = parseInt(duration) || 0
    const endDate = startDate && durationNum >= 1
        ? new Date(new Date(startDate).getTime() + (durationNum - 1) * 86400000).toISOString().slice(0, 10)
        : ''

    const handleSave = async () => {
        if (isSubmitting) return
        if (!name.trim()) { toast.error('请输入旅行名称'); return }
        if (!destinations.length) { toast.error('请选择目的地省市'); return }
        if (!startDate) { toast.error('请选择开始日期'); return }
        if (!durationNum || durationNum < 1) { toast.error('请输入行程天数'); return }

        setIsSubmitting(true)
        try {
            const trip = await createTrip({ name: name.trim(), startDate, endDate, destinations })
            toast.success(`旅行「${trip.name}」已创建`)
            setActiveView('trip', trip.id, null)
            onCreated?.(trip.id)
            handleClose()
        } catch {
            toast.error('创建旅行失败，请重试')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleClose = () => {
        setName(''); setStartDate(''); setDuration('3'); setDestinations([])
        onClose()
    }

    // Calculate end date display
    const dayCount = durationNum

    return (
        <div className="fixed inset-0 modal-viewport bg-black/30 flex items-center justify-center z-[100] p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="新建旅行" tabIndex={-1} className="dialog-card max-h-full overflow-y-auto outline-none bg-white rounded-2xl shadow-2xl max-w-[480px] w-full animate-scale-in">
                {/* Header */}
                <div className="bg-white px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-base"><PlaceIcon emoji="✈️" size={22} /></div>
                            <h2 className="text-lg font-semibold text-gray-900">新建旅行</h2>
                        </div>
                        <button aria-label="关闭" disabled={isSubmitting} onClick={() => { if (!isSubmitting) handleClose() }} className="w-8 h-8 rounded-full hover:bg-white/80 text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <fieldset disabled={isSubmitting} className="p-5 space-y-5">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">旅行名称 *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="例如：崇左周末旅行"
                            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 h-10"
                        />
                    </div>
                    <DestinationPicker value={destinations} onChange={setDestinations} />
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">开始日期 *</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 h-10 bg-white text-gray-900 box-border"
                                style={{ WebkitAppearance: 'none', lineHeight: 'normal' }}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">行程天数 *</label>
                            <div className="relative flex items-center">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={duration}
                                    onChange={e => setDuration(e.target.value.replace(/[^0-9]/g, ''))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 h-10 bg-white text-gray-900"
                                />
                                <span className="absolute right-3 text-sm text-gray-500 pointer-events-none">天</span>
                            </div>
                        </div>
                    </div>
                    {startDate && durationNum >= 1 && (
                        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                            共 {dayCount} 天，{startDate} — {endDate}
                        </p>
                    )}
                </fieldset>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
                    <button disabled={isSubmitting} onClick={() => { if (!isSubmitting) handleClose() }} className="workspace-secondary-button">取消</button>
                    <button
                        onClick={handleSave}
                        disabled={isSubmitting}
                        className="workspace-primary-button flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>创建中...</>
                        ) : '创建旅行'}
                    </button>
                </div>
            </div>
        </div>
    )
}
