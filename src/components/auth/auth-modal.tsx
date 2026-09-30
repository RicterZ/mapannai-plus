'use client'

/**
 * AuthModal — API Token 认证弹窗
 *
 * 触发时机：
 *   1. 页面初始化时，localStorage 中无 token 且服务端已启用认证（任意 API 返回 401）
 *   2. fetch 收到 401 时派发 mapannai:unauthorized 事件
 *
 * 用户输入正确 token 并提交后，存入 localStorage 并刷新页面。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { setToken, getToken } from '@/lib/auth'

export function AuthModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const openModal = useCallback(() => {
    // 若弹窗已打开，不重置输入内容（避免多个并发 401 清空正在输入的 token）
    setIsOpen((prev) => {
      if (!prev) {
        setValue('')
        setError('')
      }
      return true
    })
  }, [])

  useEffect(() => {
    // 监听 401 事件
    const handler = () => openModal()
    window.addEventListener('mapannai:unauthorized', handler)
    return () => window.removeEventListener('mapannai:unauthorized', handler)
  }, [openModal])

  useEffect(() => {
    // 自动 focus
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = value.trim()
    if (!token) {
      setError('请输入 Token')
      return
    }

    setIsVerifying(true)
    setError('')

    try {
      // 用输入的 token 探测一下 API，判断是否正确
      const res = await fetch('/api/markers', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        setError('Token 错误，请重新输入')
        setIsVerifying(false)
        return
      }
      if (!res.ok) throw new Error('服务暂时不可用')

      // token 验证通过（200 或其他非 401 状态均视为通过）
      setToken(token)
      setIsOpen(false)
      window.location.reload()
    } catch {
      setError('网络错误，请稍后重试')
      setIsVerifying(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // 不允许直接关闭（必须输入 token）
      e.preventDefault()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <div role="dialog" aria-modal="true" aria-label="访问验证" className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        {/* 标题 */}
        <div className="mb-5 text-center">
          <div className="text-3xl mb-2">🗺️</div>
          <h2 className="text-xl font-semibold text-gray-900">マップ案内</h2>
          <p className="mt-1 text-sm text-gray-500">请输入访问 Token 以继续使用</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              ref={inputRef}
              type="password"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError('') }}
              placeholder="输入 API Token"
              autoComplete="off"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
            />
            {error && (
              <p className="mt-1.5 text-xs text-red-500">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isVerifying || !value.trim()}
            className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isVerifying ? '验证中…' : '确认'}
          </button>
        </form>
      </div>
    </div>
  )
}

/**
 * AuthGate — 在首次加载时检查是否需要认证
 *
 * 通过静默请求一个 API；若返回 401，触发弹窗。
 * 若 API 无需认证（服务端未配置 API_TOKEN），直接跳过。
 */
export function AuthGate() {
  useEffect(() => {
    // 仅当 localStorage 中无 token 时才探测
    if (getToken()) return

    fetch('/api/markers', { method: 'GET' }).then((res) => {
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('mapannai:unauthorized'))
      }
    }).catch(() => { /* 网络错误忽略 */ })
  }, [])

  return null
}
