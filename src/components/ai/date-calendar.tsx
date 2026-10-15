'use client'
import { useState } from 'react'
import { calendarDayCount, selectCalendarDate } from '@/lib/ai/calendar-range'

export function DateCalendar({ value, end = '', range = false, onChange, onRangeChange }: {
    value: string; end?: string; range?: boolean; onChange: (value: string) => void
    onRangeChange?: (start: string, end: string) => void
}) {
    const [month, setMonth] = useState(() => { const date = value ? new Date(`${value}T12:00:00`) : new Date(); return new Date(date.getFullYear(), date.getMonth(), 1) })
    const [open, setOpen] = useState(true)
    const [choosingEnd, setChoosingEnd] = useState(false)
    const year = month.getFullYear(), m = month.getMonth(), offset = (month.getDay() + 6) % 7
    const count = new Date(year, m + 1, 0).getDate()
    const format = (date: string) => date ? `${date.slice(0,4)} 年 ${Number(date.slice(5,7))} 月 ${Number(date.slice(8,10))} 日` : '选择日期'
    function select(date: string) {
        if (range) {
            const next = selectCalendarDate({ start: value, end, choosingEnd }, date)
            setChoosingEnd(next.choosingEnd)
            onRangeChange?.(next.start, next.end)
        } else onChange(date)
    }
    return <div className="min-w-0">
        <button type="button" aria-label="选择旅行日期" aria-expanded={open} className="flex min-h-14 w-full items-center justify-between gap-2 border-b border-gray-100 py-3 text-left text-sm font-medium" onClick={() => { setOpen(!open); setChoosingEnd(false) }}>
            <span>{value ? `${format(value)}${range && end ? ` — ${format(end)}` : ''}` : range ? '选择出发与结束日期' : '选择日期'}</span><span aria-hidden="true" className="shrink-0 text-gray-400">{open ? '⌃' : '⌄'}</span>
        </button>
        {range && value && end && <p className="mt-2 text-xs text-gray-500">共 {calendarDayCount(value, end)} 天</p>}
        {open && <div className="py-2">
            <div className="mb-2 flex items-center justify-between text-sm font-medium"><span>{year} 年 {m+1} 月</span><div className="flex"><button type="button" aria-label="上个月" className="h-11 w-11" onClick={() => setMonth(new Date(year,m-1,1))}>‹</button><button type="button" aria-label="下个月" className="h-11 w-11" onClick={() => setMonth(new Date(year,m+1,1))}>›</button></div></div>
            <div className="grid grid-cols-7 text-center">{['一','二','三','四','五','六','日'].map(day => <span key={day} className="pb-2 text-xs text-gray-400">{day}</span>)}{Array.from({length:offset},(_,i)=><span key={`blank-${i}`} />)}{Array.from({length:count},(_,i)=>{
                const date = `${year}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
                const endpoint = date === value || (range && date === end)
                const between = range && !!value && !!end && date > value && date < end
                const left = range && value < end && (between || date === end)
                const right = range && value < end && (between || date === value)
                return <button type="button" key={date} aria-label={date} aria-pressed={endpoint || between} className="relative isolate flex h-11 min-w-0 items-center justify-center text-sm focus-visible:z-10 focus-visible:outline-slate-500" onClick={()=>select(date)}>
                    <span aria-hidden="true" className={`absolute inset-y-1 left-0 w-1/2 ${left ? 'bg-slate-100' : ''}`} /><span aria-hidden="true" className={`absolute inset-y-1 right-0 w-1/2 ${right ? 'bg-slate-100' : ''}`} />
                    <span className={`relative flex h-9 w-9 items-center justify-center rounded-full ${endpoint ? 'bg-gray-800 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{i+1}</span>
                </button>
            })}</div>
            <div className="mt-2 flex items-center justify-between gap-2"><p role="status" className="text-xs text-gray-500">{range ? choosingEnd ? '再选结束日期；同一天也可以。' : '先选出发日期，再选结束日期。' : '选择日期后点完成。'}</p><button type="button" className="min-h-11 min-w-11 text-sm font-medium disabled:text-gray-300" disabled={!value || (range && (!end || choosingEnd))} onClick={() => setOpen(false)}>完成</button></div>
        </div>}
    </div>
}
