import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMarkdown } from '../src/components/ai/chat-markdown'

const markdown = `# 东京三日游

## 第一天

先去 **浅草寺**，再去 *上野公园*。

1. 浅草寺
2. 上野公园

> 可以按天气调整。

| 地点 | 日期 |
| --- | --- |
| 浅草寺 | 10/10 |

\`trip_123\`

\`\`\`json
{"day": 1}
\`\`\`

[查看地点](https://example.com/place)
[危险链接](javascript:alert%281%29)

<img src=x onerror="alert(1)">
<script>alert(2)</script>
`
const rendered = renderToStaticMarkup(createElement(ChatMarkdown, { content: markdown }))
for (const tag of ['h1', 'h2', 'strong', 'em', 'ol', 'blockquote', 'table', 'pre']) assert(rendered.includes(`<${tag}`), tag)
assert.equal((rendered.match(/text-\[15px\]/g) || []).length, 2)
assert(!rendered.includes('<script'))
assert(!rendered.includes('<img'))
assert(!rendered.includes('href="javascript:'))
assert(rendered.includes('href="https://example.com/place"'))
assert(rendered.includes('rel="noopener noreferrer"'))
assert(rendered.includes('&lt;img'))
assert(renderToStaticMarkup(createElement(ChatMarkdown, { content: '# 尚未结束的 **流式' })).includes('<h1'))
console.log('Chat Markdown checks passed: headings, lists, tables, code, streaming fragments, safe links, and escaped model HTML.')
