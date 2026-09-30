export function compressedImageUrl(source: string): string {
    try {
        const url = new URL(source)
        if (!/^https?:$/.test(url.protocol) || !/\.cos\.[a-z0-9-]+\.myqcloud\.com$/i.test(url.hostname) || url.search) return source
        if (!/\.(jpe?g|png|webp|bmp)$/i.test(url.pathname)) return source
        return `${source}?imageMogr2/thumbnail/1200x1200%3E/format/webp/quality/75`
    } catch {
        return source
    }
}

export function compressedContentImages(content: string): string {
    if (typeof DOMParser === 'undefined') return content
    const document = new DOMParser().parseFromString(content, 'text/html')
    document.querySelectorAll('img[src]').forEach(image => {
        image.setAttribute('src', compressedImageUrl(image.getAttribute('src') || ''))
        image.setAttribute('loading', 'lazy')
    })
    return document.body.innerHTML
}
