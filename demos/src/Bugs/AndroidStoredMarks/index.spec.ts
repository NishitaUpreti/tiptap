import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'

test.use({
  userAgent:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36',
  hasTouch: true,
})

test('preserves mark toggles when the second word keeps its native composition', async ({
  page,
}) => {
  await page.goto('/src/Bugs/AndroidStoredMarks/React/')
  const editor = page.locator('.tiptap')
  const client = await page.context().newCDPSession(page)
  const compose = (text: string) =>
    client.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
  const toggleBold = () =>
    editor.evaluate(element => {
      ;(element as HTMLElement & { editor: Editor }).editor.commands.toggleBold()
    })

  await editor.click()
  await compose('Prose')
  await toggleBold()
  await compose('mirror')
  await toggleBold()
  await client.send('Input.insertText', { text: ' ' })
  await compose('prose')
  await toggleBold()
  await compose('prosemirror')
  await compose('prosemirrors')
  await client.send('Input.insertText', { text: 'prosemirrors ' })

  await expect(editor).toHaveText('Prosemirror prosemirrors ')
  await expect(editor.locator('strong')).toHaveText(['mirror', 'mirrors '])
})
