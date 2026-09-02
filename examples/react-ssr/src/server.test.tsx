import { describe, expect, it } from 'vitest'
import { renderTodoRequest } from './server.js'

describe('Todo SSR', () => {
  it('renders deterministic Todo HTML and safe hydration state', async () => {
    const response = await renderTodoRequest({ url: 'http://localhost/' })
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('>Todo<')
    expect(html).toContain('kvt-hydration')
  })

  it('does not share repository state between requests', async () => {
    const [first, second] = await Promise.all([
      renderTodoRequest({ url: 'http://localhost/' }),
      renderTodoRequest({ url: 'http://localhost/' })
    ])
    expect(await first.text()).toBe(await second.text())
  })
})
