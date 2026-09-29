'use client'
import { useState } from 'react'
import type { MapPreferences } from '@/lib/map/preferences'

export function MapProviderSettings({ value, onChange }: { value: MapPreferences; onChange: (value: MapPreferences) => void }) {
    const [open, setOpen] = useState(false)
    return <div className="absolute right-4 top-4 z-30" style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow">地图设置</button>
        {open && <div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
            <div className="mb-3 text-sm font-semibold text-gray-900">地图与地点服务</div>
            {(['basemap', 'search', 'details', 'directions'] as const).map(key => <label key={key} className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-700">
                {{ basemap: '地图底图', search: '地点搜索', details: '地点详情', directions: '路线规划' }[key]}
                <select value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs">
                    {key === 'basemap' ? <><option value="osm">OpenStreetMap</option><option value="amap">高德地图</option></> : <><option value="google">Google</option><option value="amap">高德</option></>}
                </select>
            </label>)}
            <p className="text-xs leading-relaxed text-gray-400">各项可独立组合。高德地点服务支持中国，海外地点可选择 Google。</p>
        </div>}
    </div>
}
