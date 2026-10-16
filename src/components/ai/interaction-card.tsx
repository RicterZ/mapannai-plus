'use client'
import { useEffect, useState } from 'react'
import type { InteractionPrompt } from '@/lib/ai/interaction'
import { validateSelection } from '@/lib/ai/interaction'
import { DateCalendar } from './date-calendar'
import { fetchWithAuth } from '@/lib/fetch-with-auth'

const secondsLeft = (deadline: number | null) => deadline === null ? Infinity : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))

export function InteractionCard({ prompt, apiKey }: { prompt: InteractionPrompt; apiKey: string }) {
    const [remaining, setRemaining] = useState(secondsLeft(prompt.deadline))
    const [selected, setSelected] = useState<string[]>([])
    const [start, setStart] = useState(''), [end, setEnd] = useState('')
    const [day, setDay] = useState(0), [feedback, setFeedback] = useState('')
    const [done, setDone] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
    useEffect(() => { if (prompt.deadline === null) return; const timer = setInterval(() => setRemaining(secondsLeft(prompt.deadline)), 250); return () => clearInterval(timer) }, [prompt.deadline])
    const input = prompt.input, disabled = done || !remaining || saving
    async function submit(value: unknown) {
        try { validateSelection(input, value) } catch { setError('请完成有效选择后提交'); return }
        setSaving(true); setError('')
        try {
            const response = await fetchWithAuth('/api/ai/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: prompt.id, token: prompt.token, selection: value, apiKey }) })
            if (!response.ok) throw new Error(response.status === 409 ? '此选择已结束，请在聊天中补充。' : response.status === 503 ? 'AI 正忙，请稍后再提交' : '提交失败，请重试')
            setDone(true)
        } catch (error) { setError(error instanceof Error ? error.message : '提交失败') } finally { setSaving(false) }
    }
    const field = 'min-w-0 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm'
    const button = 'rounded-lg border border-gray-200 px-3 py-2 text-xs disabled:opacity-40'
    return <section className="min-w-0 rounded-xl border border-gray-200 bg-white" aria-label={input.question}>
        <div className="p-4"><div className="mb-2 flex justify-between text-xs text-gray-500"><span>{input.kind === 'ask_choice' ? '选择偏好' : input.kind === 'ask_datetime' ? '日期与时间' : '行程草案 · 尚未保存'}</span><span>{done ? '已提交' : remaining === Infinity ? '等待选择' : remaining ? `等待选择 · ${remaining}s` : '未收到选择'}</span></div>
            <h3 className="mb-3 text-base font-semibold text-gray-800">{input.question}</h3>
            <fieldset disabled={disabled} className="min-w-0 space-y-2">
                {input.kind === 'ask_choice' && input.options.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selected.includes(option.id) ? 'border-slate-400 bg-slate-50' : 'border-gray-200'}`}>
                    <input type={input.multiple ? 'checkbox' : 'radio'} name={prompt.id} checked={selected.includes(option.id)} className="mt-1 accent-slate-600" onChange={() => setSelected(value => input.multiple ? value.includes(option.id) ? value.filter(id => id !== option.id) : value.length < input.maxSelections ? [...value, option.id] : value : [option.id])} />
                    <span><span className="block text-sm">{option.label}</span>{option.description && <span className="text-xs text-gray-500">{option.description}</span>}</span>
                </label>)}
                {input.kind === 'ask_datetime' && <>
                    <p className="text-xs text-gray-500">目的地当地时间 · {input.timezone}</p>
                    {input.mode !== 'time' && <DateCalendar value={start.slice(0,10)} end={end.slice(0,10)} range={input.mode.endsWith('_range')} onChange={date => setStart(input.mode.startsWith('datetime') ? `${date}T${start.slice(11) || ''}` : date)} onRangeChange={(a,b) => {
                        if (input.mode === 'datetime_range') { setStart(`${a}T${start.slice(11) || ''}`); setEnd(`${b}T${end.slice(11) || ''}`) }
                        else { setStart(a); setEnd(b) }
                    }} />}
                    {(input.mode === 'time' || input.mode.startsWith('datetime')) && <div className="flex gap-3 pt-2"><label className="min-w-0 flex-1 text-xs">{input.mode === 'datetime_range' ? '开始时间' : '时间'}<input aria-label="开始时间" className={field} type="time" value={input.mode === 'time' ? start : start.slice(11)} onChange={e => setStart(input.mode === 'time' ? e.target.value : start ? `${start.slice(0,10)}T${e.target.value}` : '')} disabled={!start && input.mode !== 'time'} /></label>{input.mode === 'datetime_range' && <label className="min-w-0 flex-1 text-xs">结束时间<input aria-label="结束时间" className={field} type="time" value={end.slice(11)} disabled={!end} onChange={e => setEnd(`${end.slice(0,10)}T${e.target.value}`)} /></label>}</div>}
                </>}
                {input.kind === 'preview_itinerary' && <><h4 className="text-base font-semibold">{input.title}</h4><div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="行程日期">{input.days.map((item, index) => <button key={index} type="button" role="tab" aria-selected={day === index} className={`${button} shrink-0 ${day === index ? 'border-slate-500 bg-slate-50' : ''}`} onClick={() => setDay(index)}>{item.date.slice(5)}</button>)}</div><h5 className="pt-2 text-sm font-medium">{input.days[day].title}</h5><ol className="space-y-2 text-sm">{input.days[day].places.map((place, index) => <li key={index} className="flex gap-3"><span className="text-slate-400">{index + 1}</span>{place}</li>)}</ol><textarea aria-label="调整意见" className={field} placeholder="想调整哪里？（可选）" value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={2000} /></>}
            </fieldset>
            {error && <p role="alert" className="mt-2 text-xs text-amber-700">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3"><span className="text-xs text-gray-500">{done ? '选择已交给 AI，继续规划' : !remaining ? '超时未选择，改用文字询问' : '60 秒未选择，将改用文字询问'}</span><div className="flex flex-wrap gap-2">{input.kind === 'ask_choice' && <button disabled={disabled} className={button} onClick={() => void submit({ action: 'none' })}>都不选，文字说明</button>}{input.kind === 'preview_itinerary' && <button disabled={disabled} className={button} onClick={() => void submit({ action: 'revise', feedback })}>想调整</button>}<button disabled={disabled} className={`${button} bg-slate-600 text-white`} onClick={() => void submit(input.kind === 'ask_choice' ? selected : input.kind === 'ask_datetime' ? { start, ...(input.mode.endsWith('_range') ? { end } : {}) } : { action: 'continue', feedback })}>{saving ? '提交中…' : input.kind === 'preview_itinerary' ? '确认并保存' : '确认选择'}</button></div></div>
    </section>
}
