import assert from 'node:assert/strict'
import { chatMessageSchema, visionRequest } from '../src/lib/ai/protocol'
const user = chatMessageSchema.parse({ role:'user', content:'识别车票', images:['https://images.example/ticket.png'] })
const body = visionRequest({ messages:[user,{role:'assistant',content:'好'}], tools:[] }) as any
assert.deepEqual(body.messages[0].content,[{type:'text',text:'识别车票'},{type:'image_url',image_url:{url:'https://images.example/ticket.png'}}])
assert.equal(body.messages[0].images,undefined)
assert.equal(body.messages[1].content,'好')
assert.equal(chatMessageSchema.safeParse({role:'user',content:'图',images:['file:///etc/passwd']}).success,false)
assert.equal(chatMessageSchema.safeParse({role:'user',content:'图',images:Array(5).fill('https://images.example/a.png')}).success,false)
assert.equal(chatMessageSchema.parse({role:'user',content:'纯文本'}).content,'纯文本')
console.log('Image attachment validation and standard vision request conversion passed')
