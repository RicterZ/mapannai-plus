import { lookup } from 'node:dns'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export function isPublicAddress(address: string): boolean {
    if (isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number)
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && (b === 18 || b === 19)))
    }
    // Only globally routable IPv6 unicast; mapped IPv4 and local ranges are excluded.
    return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address)
}

export function completionUrl(baseUrl: string, allowPrivate = process.env.AI_ALLOW_PRIVATE_ENDPOINTS === 'true'): URL {
    let url: URL
    try { url = new URL(baseUrl.trim()) } catch { throw new Error('请填写有效的 AI API 地址') }
    if (url.username || url.password || url.search || url.hash ||
        !['https:', 'http:'].includes(url.protocol)) throw new Error('API 地址需为 HTTP(S) 地址，不能包含凭据、查询参数或片段')
    if (!allowPrivate && url.protocol !== 'https:') throw new Error('AI API 需使用 HTTPS；自托管 HTTP 服务需由管理员启用私有地址访问')
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (!allowPrivate && (hostname === 'localhost' || (isIP(hostname) && !isPublicAddress(hostname)))) {
        throw new Error('此 AI API 地址属于私有网络，需由管理员启用私有地址访问')
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions'
    return url
}

/** Validate the address resolved for this connection; do not follow redirects with a key. */
export function requestCompletion(url: URL, apiKey: string, body: unknown, signal: AbortSignal, allowPrivate = process.env.AI_ALLOW_PRIVATE_ENDPOINTS === 'true'): Promise<Response> {
    return new Promise((resolve, reject) => {
        const send = url.protocol === 'https:' ? httpsRequest : httpRequest
        const req = send(url, {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            lookup: (hostname, options, callback) => {
                lookup(hostname, { ...options, all: true }, (error, addresses) => {
                    if (error) { callback(error, [], undefined); return }
                    if (!allowPrivate && addresses.some(item => !isPublicAddress(item.address))) {
                        callback(new Error('私有网络地址未启用'), [], undefined); return
                    }
                    if (options.all) callback(null, addresses)
                    else callback(null, addresses[0].address, addresses[0].family)
                })
            },
        }, response => {
            const status = response.statusCode || 502
            if (status !== 200) {
                response.resume()
                reject(new Error(`AI API 返回 HTTP ${status}，请检查地址、Key、模型及工具调用支持`))
                return
            }
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    response.on('data', (chunk: Buffer) => { controller.enqueue(new Uint8Array(chunk)); response.pause() })
                    response.on('end', () => controller.close())
                    response.on('error', error => controller.error(error))
                },
                pull() { response.resume() },
                cancel() { response.destroy(); req.destroy() },
            })
            resolve(new Response(stream, { headers: { 'Content-Type': String(response.headers['content-type'] || '') } }))
        })
        req.on('error', () => reject(new Error(signal.aborted ? 'AI 请求已停止或超时' : '无法连接 AI API，请检查地址与网络配置')))
        req.end(JSON.stringify(body))
    })
}
