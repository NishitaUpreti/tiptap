import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import Italic from '@tiptap/extension-italic'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { Editor } from '../Editor.js'

let editor: Editor

function createEditor(content = '<p>prose</p>', android = true, enabled = true) {
  vi.stubGlobal('navigator', { userAgent: android ? 'Android' : 'Linux' })
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, Italic],
    content,
    enableCoreExtensions: { keymap: enabled },
  })
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  return editor
}

function reconcile(text: string, from = 1, to = editor.state.doc.content.size - 1) {
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)))
  const transaction = editor.state.tr.insertText(text, from, to).setMeta('composition', 1)

  editor.view.dispatch(transaction)
}

afterEach(() => {
  editor?.destroy()
  vi.unstubAllGlobals()
})

describe('Android stored marks during composition', () => {
  it('preserves toggled marks after composition reconciles its selection', () => {
    createEditor()
    editor.commands.toggleBold()

    reconcile('prosemirror')

    expect(editor.getHTML()).toBe('<p>prose<strong>mirror</strong></p>')
  })

  it('restores marks removed from previously composed text', () => {
    createEditor()
    editor.commands.toggleBold()
    reconcile('prosemirror')
    reconcile('prosemirrors')

    expect(editor.getHTML()).toBe('<p>prose<strong>mirrors</strong></p>')
  })

  it('keeps multiple marks', () => {
    createEditor()
    editor.commands.toggleBold()
    editor.commands.toggleItalic()

    reconcile('prosemirror')

    expect(editor.getHTML()).toBe('<p>prose<strong><em>mirror</em></strong></p>')
  })

  it('preserves requested mark attributes', () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' })
    editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Bold.extend({
          addAttributes: () => ({ tone: { default: 'normal', renderHTML: () => ({}) } }),
        }),
      ],
      content: '<p>prose</p>',
    })
    editor.commands.setTextSelection(6)
    editor.commands.setMark('bold', { tone: 'accent' })
    reconcile('prosemirror')

    expect(editor.state.doc.firstChild?.lastChild?.marks[0].attrs.tone).toBe('accent')
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([])
  })
})

describe('Android stored mark boundaries', () => {
  it('does not apply a toggle to corrected text before its boundary', () => {
    createEditor()
    editor.commands.toggleBold()
    reconcile('prasemirror')

    expect(editor.getHTML()).toBe('<p>prase<strong>mirror</strong></p>')
  })

  it('preserves the boundary while a keyboard deletes and restores its word', () => {
    createEditor()
    editor.commands.toggleBold()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
    editor.view.dispatch(editor.state.tr.delete(1, 6).setMeta('composition', 1))
    reconcile('prosemirror', 1, 1)

    expect(editor.getHTML()).toBe('<p>prose<strong>mirror</strong></p>')
  })

  it('preserves an explicit mark removal without stripping earlier text', () => {
    createEditor('<p><strong>prose</strong></p>')
    editor.commands.toggleBold()

    editor.view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(1, 6, editor.schema.text('prosemirror', [editor.schema.marks.bold.create()]))
        .setMeta('composition', 1),
    )

    expect(editor.getHTML()).toBe('<p><strong>prose</strong>mirror</p>')
  })
})

describe('Android stored mark lifetime', () => {
  it('clears pending marks on deliberate selection changes', async () => {
    createEditor()
    editor.commands.toggleBold()
    reconcile('prosemirror')
    await new Promise(resolve => setTimeout(resolve, 0))
    editor.commands.setTextSelection(1)
    reconcile('xprosemirror')

    expect(editor.getHTML()).toBe('<p>xprosemirror</p>')
  })

  it('does not format remote or programmatic text changes', () => {
    createEditor()
    editor.commands.toggleBold()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    editor.view.dispatch(editor.state.tr.insertText('remote', 1, 6))

    expect(editor.getHTML()).toBe('<p>remote</p>')
  })

  it('clears pending marks when the editor loses focus', () => {
    createEditor()
    editor.commands.toggleBold()
    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    reconcile('prosemirror')

    expect(editor.getHTML()).toBe('<p>prosemirror</p>')
  })

  it('does not carry intent across a remote change during composition', () => {
    createEditor()
    editor.commands.toggleBold()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    editor.view.dispatch(editor.state.tr.insertText('remote', 1, 6))
    reconcile('remoteword')

    expect(editor.getHTML()).toBe('<p>remoteword</p>')
  })
})

describe('Android stored mark activation', () => {
  it('allows disabling the workaround', () => {
    createEditor('<p>prose</p>', true, false)
    editor.commands.toggleBold()
    reconcile('prosemirror')

    expect(editor.getHTML()).toBe('<p>prosemirror</p>')
  })

  it('does not affect non-Android editors', () => {
    createEditor('<p>prose</p>', false)
    editor.commands.toggleBold()

    reconcile('prosemirror')

    expect(editor.getHTML()).toBe('<p>prosemirror</p>')
  })
})
