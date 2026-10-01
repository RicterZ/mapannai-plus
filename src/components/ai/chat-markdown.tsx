import React, { Fragment, useMemo, type ReactNode } from 'react'
import { marked, type MarkedToken, type Token } from 'marked'

function safeHref(href: string): string | undefined {
    try {
        const url = new URL(href)
        return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined
    } catch { return undefined }
}

function renderTokens(tokens: Token[]): ReactNode {
    return tokens.map((value, index) => {
        const token = value as MarkedToken
        const children = 'tokens' in token && token.tokens ? renderTokens(token.tokens) : null
        switch (token.type) {
            case 'space': case 'def': return null
            case 'heading': {
                const Heading = `h${token.depth}` as 'h1'
                return <Heading key={index} className="mb-2 mt-3 text-[15px] font-semibold leading-6 first:mt-0">{children}</Heading>
            }
            case 'paragraph': return <p key={index} className="my-2 first:mt-0 last:mb-0">{children}</p>
            case 'strong': return <strong key={index} className="font-semibold">{children}</strong>
            case 'em': return <em key={index}>{children}</em>
            case 'del': return <del key={index}>{children}</del>
            case 'br': return <br key={index} />
            case 'hr': return <hr key={index} className="my-3 border-gray-200" />
            case 'codespan': return <code key={index} className="rounded bg-gray-200/60 px-1 py-0.5 font-mono text-xs">{token.text}</code>
            case 'code': return <pre key={index} className="my-2 max-w-full overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs leading-5 text-gray-100"><code>{token.text}</code></pre>
            case 'blockquote': return <blockquote key={index} className="my-2 border-l-2 border-gray-300 pl-3 text-gray-600">{children}</blockquote>
            case 'list': {
                const List = token.ordered ? 'ol' : 'ul'
                return <List key={index} start={token.ordered ? Number(token.start) || 1 : undefined} className={`my-2 space-y-1 pl-5 ${token.ordered ? 'list-decimal' : 'list-disc'}`}>
                    {token.items.map((item, itemIndex) => <li key={itemIndex}>
                        {item.task && <input type="checkbox" checked={!!item.checked} readOnly tabIndex={-1} aria-label={item.checked ? '已完成' : '未完成'} className="mr-2 align-middle" />}
                        {renderTokens(item.tokens)}
                    </li>)}
                </List>
            }
            case 'link': {
                const href = safeHref(token.href)
                return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline underline-offset-2">{children}</a> : <Fragment key={index}>{children}</Fragment>
            }
            case 'image': return <span key={index}>{token.text}</span>
            case 'table': return <div key={index} className="my-2 max-w-full overflow-x-auto"><table className="w-full border-collapse text-left text-xs leading-5">
                <thead><tr>{token.header.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: cell.align || undefined }} className="border border-gray-200 bg-gray-100 px-2 py-1.5 font-semibold">{renderTokens(cell.tokens)}</th>)}</tr></thead>
                <tbody>{token.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ textAlign: cell.align || undefined }} className="border border-gray-200 px-2 py-1.5">{renderTokens(cell.tokens)}</td>)}</tr>)}</tbody>
            </table></div>
            // Never inject model HTML, including inline tags and event handlers.
            case 'html': case 'escape': return <span key={index} className="whitespace-pre-wrap">{token.text}</span>
            case 'text': return <Fragment key={index}>{children || token.text}</Fragment>
            default: return <span key={index}>{value.raw}</span>
        }
    })
}

export function ChatMarkdown({ content }: { content: string }) {
    const tokens = useMemo(() => marked.lexer(content, { gfm: true, breaks: true }), [content])
    return <div className="min-w-0 break-words text-sm leading-6">{renderTokens(tokens)}</div>
}
