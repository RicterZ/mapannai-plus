/** Plain one-line text of a rich-text note. */
export function noteExcerpt(html: string | undefined) {
    return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

/** Editors leave markup such as `<p></p>` behind; only text or images count as note content. */
export function hasNoteContent(html: string | undefined) {
    return !!noteExcerpt(html) || /<img\b/i.test(html || '')
}
