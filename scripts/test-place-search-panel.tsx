import React from 'react'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlaceSearchPanel } from '../src/components/map/place-search-panel'

const result = { id: 'saved-result', name: '<东京公园>', address: '台东区', coordinates: { latitude: 35.7, longitude: 139.7 }, markerId: 'saved', iconType: 'park' as const }
const props = { open: true, query: '公园', results: [result], selectedKey: null, busy: false, addingKey: null, error: '', targetLabel: '东京 · 第2天', isAdded: () => false, onClose() {}, onQuery() {}, onSelect() {}, onAdd() {} }
const render = (patch: Partial<typeof props> = {}) => renderToStaticMarkup(<PlaceSearchPanel {...props} {...patch} />)
const html = render()
assert.match(html, /添加到 · 东京 · 第2天/)
assert.match(html, /已收藏/)
assert.match(html, /&lt;东京公园&gt;/)
assert.doesNotMatch(html, /<东京公园>/)
assert.match(render({ isAdded: () => true }), /disabled=""[^>]*aria-label="&lt;东京公园&gt;已添加"/)
assert.equal(render({ open: false }), '')
assert.match(render({ results: [], busy: true }), /搜索中…/)
assert.match(render({ results: [], error: '服务失败' }), /服务失败/)
console.log('Place search panel passed: target label, saved and assigned states, escaping, closed state, loading and failure.')
