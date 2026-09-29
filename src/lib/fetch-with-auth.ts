/**
 * 带 Token 认证的 fetch 封装
 *
 * 自动从 localStorage 读取 token 并注入 Authorization: Bearer 头。
 * 收到 401 时：清除本地 token 并派发 mapannai:unauthorized 事件，
 * 由 AuthModal 监听后弹出重新输入弹窗。
 *
 * 使用节流：连续的 401 只触发一次事件，避免多个并发请求反复清空弹窗输入内容。
 */

import { getToken, clearToken } from './auth'

let unauthorizedPending = false

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(input, { ...init, headers })

  if (res.status === 401) {
    clearToken()
    if (typeof window !== 'undefined' && !unauthorizedPending) {
      unauthorizedPending = true
      window.dispatchEvent(new CustomEvent('mapannai:unauthorized'))
      // 500ms 内的并发 401 只触发一次
      setTimeout(() => { unauthorizedPending = false }, 500)
    }
  }

  return res
}
