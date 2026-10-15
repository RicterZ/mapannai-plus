'use client'
import { useState } from 'react'
export function DateCalendar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const [month, setMonth] = useState(() => { const date = value ? new Date(`${value}T12:00:00`) : new Date(); return new Date(date.getFullYear(), date.getMonth(), 1) })
    const year = month.getFullYear(), m = month.getMonth(), offset = (month.getDay() + 6) % 7
    const count = new Date(year, m + 1, 0).getDate()
    return <div className="py-2"><div className="mb-2 flex items-center justify-between text-sm"><button type="button" aria-label="上个月" className="h-9 w-9" onClick={() => setMonth(new Date(year,m-1,1))}>‹</button><span>{year} 年 {m+1} 月</span><button type="button" aria-label="下个月" className="h-9 w-9" onClick={() => setMonth(new Date(year,m+1,1))}>›</button></div><div className="grid grid-cols-7 gap-1 text-center">{['一','二','三','四','五','六','日'].map(day => <span key={day} className="text-xs text-gray-400">{day}</span>)}{Array.from({length:offset},(_,i)=><span key={`blank-${i}`} />)}{Array.from({length:count},(_,i)=>{
        const date = `${year}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
        return <button type="button" key={date} aria-label={date} aria-pressed={value===date} className={`h-9 rounded-md text-xs ${value===date?'bg-slate-600 text-white':'hover:bg-gray-50'}`} onClick={()=>onChange(date)}>{i+1}</button>
    })}</div></div>
}
