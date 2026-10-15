'use client'
import { useState } from 'react'
export function SavedOverview({ content }: { content: string }) {
    const [index, setIndex] = useState(0)
    let result
    try { result = JSON.parse(content) } catch { return null }
    const trip = result.savedOverview
    if (!result.verified || !trip?.days?.length) return null
    const day = trip.days[Math.min(index, trip.days.length - 1)]
    return <section className="rounded-xl border border-gray-200 bg-white p-4"><p className="mb-1 text-xs text-gray-500">已保存并核实</p><h3 className="text-base font-semibold">{trip.name || trip.title || '旅行安排'}</h3><div className="my-3 flex gap-2 overflow-x-auto">{trip.days.map((item: {date:string},i:number)=><button type="button" key={i} aria-pressed={index===i} className={`shrink-0 rounded-md px-2 py-2 text-xs ${index===i?'bg-slate-100 text-gray-900':'text-gray-500'}`} onClick={()=>setIndex(i)}>{item.date}</button>)}</div><h4 className="text-sm font-medium">{day.title || '当日安排'}</h4><ol className="mt-2 space-y-2 text-sm">{(day.places || []).map((place:string,i:number)=><li key={i}>{i+1}. {place}</li>)}</ol></section>
}
