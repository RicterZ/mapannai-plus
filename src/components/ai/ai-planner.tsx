'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, Plus, Settings, Square, Trash2, X, Send, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useMapStore } from '@/store/map-store'
import { useAiMapEffects } from '@/lib/ai/use-ai-map-effects'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import { cn } from '@/utils/cn'
import { ChatMarkdown } from './chat-markdown'
import { aiSettingsSchema, repairInterruptedMessages, toolLabels, type ChatEvent, type ChatMessage } from '@/lib/ai/protocol'
import { defaultSettings, emptyHistory, HISTORY_KEY, newConversation, readHistory, readSettings, writeSettings, type LocalHistory, type LocalSettings } from '@/lib/ai/local-history'

const fieldClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500'
const iconClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-40'

export function AiPlanner({ onMarkersCreated }: { onMarkersCreated: (ids: string[], panel: DOMRect | null) => void }) {
    const [open, setOpen] = useState(false)
    const [hydrated, setHydrated] = useState(false)
    const [history, setHistory] = useState<LocalHistory>(emptyHistory)
    const [storageError, setStorageError] = useState<string | null>(null)
    const [storageReadable, setStorageReadable] = useState(false)
    const [settings, setSettings] = useState<LocalSettings>(defaultSettings)
    const [draft, setDraft] = useState<LocalSettings>(defaultSettings)
    const [showSettings, setShowSettings] = useState(false)
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [partial, setPartial] = useState('')
    const [status, setStatus] = useState('正在思考…')
    const [error, setError] = useState<string | null>(null)
    const requestRef = useRef<AbortController | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const refreshRef = useRef<Promise<void> | null>(null)
    const refreshAgain = useRef(false)
    const followRef = useRef(true)
    const panelRef = useRef<HTMLDivElement>(null)
    const handleMapResult = useAiMapEffects({ enabled: open, refresh: refreshMap,
        onCreated: ids => onMarkersCreated(ids, panelRef.current?.getBoundingClientRect() || null) })
    useEffect(() => {
        if (!open) return
        const previous = document.activeElement as HTMLElement | null
        panelRef.current?.focus({ preventScroll: true })
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !panelRef.current?.contains(document.activeElement)) return
            // Other form dialogs retain their own Escape behavior.
            if (Array.from(document.querySelectorAll('[aria-modal="true"]')).some(dialog => dialog.getClientRects().length)) return
            event.preventDefault(); setOpen(false)
        }
        document.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('keydown', escape)
            if (panelRef.current?.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true })
        }
    }, [open])
    const conversation = history.conversations.find(item => item.id === history.activeId)

    useEffect(() => {
        try { setHistory(readHistory(localStorage)); setStorageReadable(true) }
        catch { setStorageError('无法读取本地聊天记录，原记录已保留。可清空后重新开始。') }
        try {
            const saved = readSettings(localStorage)
            setSettings(saved); setDraft(saved); setShowSettings(!saved.model)
        } catch { setShowSettings(true); toast.error('AI 设置无法读取，请重新配置') }
        setHydrated(true)
        return () => requestRef.current?.abort()
    }, [])
    useEffect(() => {
        if (!hydrated || !storageReadable) return
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); setStorageError(null) }
        catch { setStorageError('本地记录未能保存，请检查浏览器存储空间；当前聊天仍可继续。') }
    }, [history, hydrated, storageReadable])
    useEffect(() => { if (panelRef.current) panelRef.current.inert = !open }, [open, panelRef])
    useEffect(() => {
        if (followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, [history, partial, status, error, open])

    useEffect(() => {
        const input = inputRef.current
        if (!input) return
        input.style.height = '0px'
        input.style.height = `${Math.min(120, Math.max(24, input.scrollHeight))}px`
    }, [text])

    function updateConversation(id: string, update: (item: NonNullable<typeof conversation>) => NonNullable<typeof conversation>) {
        setHistory(previous => ({ ...previous, conversations: previous.conversations.map(item => item.id === id ? update(item) : item) }))
    }
    function createChat() {
        if (requestRef.current) return
        if (history.conversations.length >= 20) { toast.error('最多保留 20 个会话，请先删除不需要的记录'); return }
        const next = newConversation()
        setHistory(previous => ({ ...previous, activeId: next.id, conversations: [next, ...previous.conversations] }))
        setText(''); setError(null); setPartial(''); followRef.current = true
    }
    function refreshMap(): Promise<void> {
        refreshAgain.current = true
        if (refreshRef.current) return refreshRef.current
        refreshRef.current = (async () => {
            while (refreshAgain.current) {
                refreshAgain.current = false
                const store = useMapStore.getState()
                await Promise.all([store.loadMarkersFromDataset(), store.loadTripsFromDataset()])
                const latest = useMapStore.getState()
                if (latest.activeView.tripId && !latest.trips.some(trip => trip.id === latest.activeView.tripId)) {
                    latest.setActiveView('overview', null, null, { focusFirstMarker: false })
                } else if (latest.activeView.dayId && !latest.tripDays.some(day => day.id === latest.activeView.dayId)) {
                    latest.setActiveView('trip', latest.activeView.tripId, null, { focusFirstMarker: false })
                }
            }
        })().finally(() => { refreshRef.current = null })
        return refreshRef.current
    }
    async function send() {
        const content = text.trim()
        if (!content || requestRef.current) return
        if (!aiSettingsSchema.safeParse(settings).success) { setShowSettings(true); setError('请先填写 API 地址与模型'); return }
        if (!conversation && history.conversations.length >= 20) { toast.error('请先删除一个旧会话'); return }
        const current = conversation || newConversation()
        const messages: ChatMessage[] = [...repairInterruptedMessages(current.messages), { role: 'user', content }]
        if (messages.length > 180) { setError('这个会话已较长，请新建会话继续规划；原记录会保留。'); return }
        const controller = new AbortController()
        requestRef.current = controller
        followRef.current = true
        setBusy(true); setError(null); setPartial(''); setStatus('正在思考…'); setText('')
        setHistory(previous => ({ ...previous, activeId: current.id, conversations: [
            { ...current, title: current.messages.length ? current.title : content.slice(0, 40), messages, updatedAt: new Date().toISOString() },
            ...previous.conversations.filter(item => item.id !== current.id),
        ] }))
        let preview = '', completed = false
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        const event = (item: ChatEvent) => {
            if (item.type === 'delta') { preview += item.text; setPartial(preview); setStatus('正在回复…') }
            if (item.type === 'message') {
                if (item.message.role === 'assistant') { preview = ''; setPartial('') }
                handleMapResult(item.message)
                updateConversation(current.id, value => ({ ...value, messages: [...value.messages, item.message], updatedAt: new Date().toISOString() }))
            }
            if (item.type === 'status') setStatus(toolLabels[item.name] ? `${toolLabels[item.name]}…` : '正在处理行程…')
            if (item.type === 'changed') void refreshMap()
            if (item.type === 'complete') completed = true
            if (item.type === 'error') throw new Error(item.message)
        }
        try {
            const active = useMapStore.getState().activeView
            const now = new Date()
            const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
            const response = await fetchWithAuth('/api/ai/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ settings: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model }, messages,
                    context: { localDate, tripId: active.tripId, dayId: active.dayId } }),
            })
            if (!response.ok) {
                const result = await response.json().catch(() => ({}))
                throw new Error(response.status === 401 ? '请先完成本站访问认证' : result.error || '聊天请求失败，请重试')
            }
            reader = response.body?.getReader()
            if (!reader) throw new Error('未收到 AI 回复')
            const decoder = new TextDecoder()
            let buffer = ''
            while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                buffer += decoder.decode(chunk.value, { stream: true })
                let end: number
                while ((end = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
                    if (line.trim()) event(JSON.parse(line))
                }
            }
            buffer += decoder.decode()
            if (buffer.trim()) event(JSON.parse(buffer))
            if (!completed) throw new Error('连接已中断，已完成的操作会保留，请确认行程后继续')
        } catch (failure) {
            setError(controller.signal.aborted ? '已停止。已完成的操作会保留；正在执行的操作可能仍会保存，请确认行程后继续。'
                : failure instanceof Error ? failure.message : '请求失败，请重试')
            if (preview) updateConversation(current.id, value => ({ ...value, messages: [...value.messages, { role: 'assistant', content: preview + '\n\n（回复已中断）' }] }))
        } finally {
            await reader?.cancel().catch(() => {})
            reader?.releaseLock()
            requestRef.current = null; setBusy(false); setPartial('')
            await refreshMap()
        }
    }

    return <>
        <button onClick={() => setOpen(true)} className="absolute right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg hover:bg-gray-50" style={{ top: 'calc(env(safe-area-inset-top) + env(safe-area-inset-top) + 12px)' }} aria-label="打开 AI 行程规划">
            <MessageCircle size={18} />{busy && <span className="absolute right-2 top-2 h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
        </button>
        {hydrated && createPortal(<>
            <div ref={panelRef} role="dialog" aria-modal="false" aria-hidden={!open} aria-label="AI 行程规划" tabIndex={-1}
                className={cn('ai-planner-panel dialog-card app-panel modal-viewport fixed right-0 z-[80] flex w-full flex-col bg-white !p-0 shadow-2xl outline-none sm:w-[560px] sm:max-w-[calc(100vw-80px)]', open ? 'translate-x-0 panel-open' : 'translate-x-full panel-closed')}>
                <div className="shrink-0 border-b border-gray-100 px-4" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-gray-900">AI 行程规划</h2>
                        <div className="flex items-center">
                            <button className={iconClass} disabled={busy} onClick={createChat} title="新建会话" aria-label="新建会话"><Plus size={18} /></button>
                            <button className={iconClass} onClick={() => { setDraft(settings); setShowSettings(value => !value) }} aria-label="AI 设置" aria-expanded={showSettings}><Settings size={18} /></button>
                            <button className={iconClass} onClick={() => setOpen(false)} aria-label="返回地图"><X size={20} /></button>
                        </div>
                    </div>
                    {history.conversations.length > 0 && <div className="mb-2 flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                        <select aria-label="聊天记录" value={history.activeId || ''} disabled={busy} className="w-full min-w-0 appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-10 text-sm" onChange={e => {
                            setHistory(previous => ({ ...previous, activeId: e.target.value })); setError(null); setText(''); followRef.current = true
                        }}>{history.conversations.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        </div>
                        <button className={iconClass} disabled={busy || !conversation} aria-label="删除当前聊天记录" title="删除当前聊天记录" onClick={() => {
                            setHistory(previous => { const remaining = previous.conversations.filter(item => item.id !== previous.activeId); return { ...previous, conversations: remaining, activeId: remaining[0]?.id || null } })
                            setError(null); setText('')
                        }}><Trash2 size={16} /></button>
                    </div>}
                </div>
                <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" onScroll={e => {
                    const node = e.currentTarget; followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
                }}>
                    {showSettings && <form className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4" onSubmit={e => {
                        e.preventDefault()
                        if (!aiSettingsSchema.safeParse(draft).success) { toast.error('请填写有效的 API 地址、Key 和模型'); return }
                        try {
                            const url = new URL(draft.baseUrl)
                            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error()
                        } catch { toast.error('请填写有效的 HTTP(S) API 地址'); return }
                        const next = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() }
                        setSettings(next); setDraft(next); setShowSettings(false)
                        try { writeSettings(localStorage, next) } catch { toast.error('配置仅在当前页面生效，浏览器未能保存设置') }
                    }}>
                        <label className="block text-xs text-gray-600">API 地址<input className={cn(fieldClass, 'mt-1')} type="url" required value={draft.baseUrl} onChange={e => setDraft(value => ({ ...value, baseUrl: e.target.value }))} placeholder="https://your-api.example/v1" autoComplete="off" /></label>
                        <label className="block text-xs text-gray-600">API Key<input className={cn(fieldClass, 'mt-1')} type="password" value={draft.apiKey} onChange={e => setDraft(value => ({ ...value, apiKey: e.target.value }))} placeholder="API Key" autoComplete="off" /></label>
                        <label className="block text-xs text-gray-600">模型<input className={cn(fieldClass, 'mt-1')} required value={draft.model} onChange={e => setDraft(value => ({ ...value, model: e.target.value }))} placeholder="模型名称" autoComplete="off" /></label>
                        <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={draft.rememberKey} onChange={e => setDraft(value => ({ ...value, rememberKey: e.target.checked }))} />在本浏览器记住 Key</label>
                        <button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">保存设置</button>
                    </form>}
                    {storageError && <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">{storageError}
                        {!storageReadable && <button className="ml-2 underline" disabled={busy} onClick={() => {
                            try { localStorage.removeItem(HISTORY_KEY); setHistory({ ...emptyHistory, conversations: [] }); setStorageReadable(true); setStorageError(null) }
                            catch { toast.error('浏览器存储不可用') }
                        }}>清空本地记录</button>}
                    </div>}
                    {conversation?.messages.map((message, index) => <ChatBubble key={index} message={message} />)}
                    {partial && <div className="min-w-0 rounded-2xl bg-gray-50 p-3 text-gray-800"><ChatMarkdown content={partial} /></div>}
                    {busy && <p role="status" className="flex items-center gap-2 text-xs text-gray-500"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />{status}</p>}
                    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">{error}</p>}
                </div>
                <form className="shrink-0 border-t border-gray-100 px-4 pt-2" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }} onSubmit={e => { e.preventDefault(); void send() }}>
                    <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 pl-3 pr-1 transition-colors focus-within:border-blue-400 focus-within:bg-white">
                        <textarea ref={inputRef} aria-label="发给 AI 的消息" className="my-2 max-h-[120px] min-h-6 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400" rows={1} maxLength={30_000} disabled={busy} value={text} onChange={e => setText(e.target.value)} placeholder="输入消息…" onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send() }
                        }} />
                        {busy ? <button type="button" onClick={() => requestRef.current?.abort()} className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600" aria-label="停止回复"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 transition-colors group-hover:bg-gray-200"><Square size={14} /></span></button>
                            : <button type="submit" disabled={!text.trim()} className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-blue-600 disabled:text-gray-300" aria-label="发送消息"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 transition-colors group-hover:bg-blue-100 group-disabled:bg-transparent"><Send size={16} /></span></button>}
                    </div>
                </form>
            </div>
        </>, document.body)}
    </>
}

function ChatBubble({ message }: { message: ChatMessage }) {
    if (message.role === 'tool') {
        let failed = false
        try {
            const result = JSON.parse(message.content)
            failed = !!result.isError || !!result.error || !!result.content?.some((part: { type: string; text?: string }) => {
                if (part.type !== 'text' || !part.text) return false
                try { return JSON.parse(part.text).results?.some((item: { status?: string }) => item.status === 'error') } catch { return false }
            })
        } catch { failed = true }
        return <p className={cn('text-xs', failed ? 'text-amber-700' : 'text-gray-500')}>{failed ? '⚠' : '✓'} {toolLabels[message.name || ''] || '行程操作'}{failed ? '未完成，请查看回复' : '已返回结果'}</p>
    }
    if (!message.content) return null
    return message.role === 'user'
        ? <div className="ml-6 whitespace-pre-wrap break-words rounded-2xl bg-blue-50 p-3 text-sm leading-6 text-blue-950">{message.content}</div>
        : <div className="mr-2 min-w-0 rounded-2xl bg-gray-50 p-3 text-gray-800"><ChatMarkdown content={message.content} /></div>
}
