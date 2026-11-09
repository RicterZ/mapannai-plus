/** Plain one-line text of a rich-text note. */
export function noteExcerpt(html: string | undefined) {
    return (html || '')
        .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
        .replace(/<(style|script|head|title|template|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (m, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : m)
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

/** Editors leave markup such as `<p></p>` behind; only text or images count as note content. */
export function hasNoteContent(html: string | undefined) {
    return !!noteExcerpt(html) || /<img\b/i.test(html || '')
}
