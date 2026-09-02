import { renderTodoRequest } from '../examples/react-ssr/dist/server.js'

const requests = 1_000
const concurrency = 25
let completed = 0
for (let offset = 0; offset < requests; offset += concurrency) {
  const batch = Array.from({ length: Math.min(concurrency, requests - offset) }, (_, index) => {
    const requestId = offset + index
    const cspNonce = `request-${requestId}"<`
    return renderTodoRequest({
      url: `http://localhost/?request=${requestId}`,
      cspNonce
    }).then(async (response) => {
      const html = await response.text()
      const encodedNonce = `nonce="request-${requestId}&quot;&lt;"`
      if (response.status !== 200 || !html.includes('>Todo<') || !html.includes(encodedNonce)) {
        throw new Error(`SSR request ${requestId} was mixed, incomplete or serialized unsafely`)
      }
      completed++
    })
  })
  await Promise.all(batch)
}
if (completed !== requests) throw new Error(`SSR soak completed ${completed}/${requests} requests`)
console.log(`SSR soak passed: ${completed} isolated request runtimes rendered and shut down.`)
