import { Mark } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'

interface PendingMarks {
  marks: readonly Mark[]
  from: number
  deletedOffset: number
}

const pluginKey = new PluginKey<PendingMarks | null>('androidStoredMarks')

function mapPendingMarks(pending: PendingMarks, transaction: Transaction): PendingMarks {
  let { from, deletedOffset } = pending

  for (const map of transaction.mapping.maps) {
    let nextFrom = map.map(from, -1)

    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      const containsBoundary = from > oldStart && from <= oldEnd
      const restoresBoundary = deletedOffset > 0 && from === oldStart

      if (containsBoundary || restoresBoundary) {
        const offset = from - oldStart + deletedOffset
        const available = Math.min(offset, newEnd - newStart)

        nextFrom = newStart + available
        deletedOffset = offset - available
      }
    })
    from = nextFrom
  }

  return { ...pending, from, deletedOffset }
}

function capturePendingMarks(transaction: Transaction): PendingMarks | null {
  if (!transaction.selection.empty || !transaction.storedMarks) {
    return null
  }

  return { marks: transaction.storedMarks, from: transaction.selection.from, deletedOffset: 0 }
}

function shouldClearPendingMarks(transaction: Transaction, compositionEvent: boolean): boolean {
  if (transaction.getMeta('composition')) {
    return false
  }

  return transaction.docChanged || (transaction.selectionSet && !compositionEvent)
}

function applyPendingMarks(
  transaction: Transaction,
  pending: PendingMarks | null,
  compositionEvent: boolean,
): PendingMarks | null {
  const applied = transaction.getMeta(pluginKey) as PendingMarks | null | undefined

  if (applied !== undefined) {
    return applied
  }

  if (transaction.storedMarksSet && !transaction.docChanged) {
    return capturePendingMarks(transaction)
  }

  if (!pending) {
    return null
  }

  if (shouldClearPendingMarks(transaction, compositionEvent)) {
    return null
  }

  return mapPendingMarks(pending, transaction)
}

function appendPendingMarks(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const pending = pluginKey.getState(newState)
  const composedText = transactions.some(
    transaction => transaction.docChanged && transaction.getMeta('composition'),
  )

  if (!pending || !newState.selection.empty || !composedText) {
    return null
  }

  const start = oldState.doc.content.findDiffStart(newState.doc.content)
  const end = oldState.doc.content.findDiffEnd(newState.doc.content)

  if (start === null || !end) {
    return null
  }

  const from = Math.max(start, pending.from + pending.deletedOffset)
  const to = end.b

  if (from >= to) {
    return null
  }

  const transaction = newState.tr

  newState.doc.nodesBetween(from, to, (node, position, parent) => {
    if (!node.isText || !parent) {
      return
    }

    const marks = parent.type.allowedMarks(pending.marks)

    if (Mark.sameSet(node.marks, marks)) {
      return
    }

    const start = Math.max(position, from)
    const end = Math.min(position + node.nodeSize, to)

    transaction.removeMark(start, end)
    marks.forEach(mark => transaction.addMark(start, end, mark))
  })
  transaction.setMeta(pluginKey, pending)
  return transaction.steps.length ? transaction : null
}

export function createAndroidStoredMarksPlugin(): Plugin<PendingMarks | null> {
  let compositionEvent = false
  let compositionTimeout: ReturnType<typeof setTimeout> | undefined
  const startCompositionEvent = () => {
    compositionEvent = true
    clearTimeout(compositionTimeout)
    compositionTimeout = setTimeout(() => {
      compositionEvent = false
    }, 0)
    return false
  }
  const clearPendingMarks = (view: { state: EditorState; dispatch: (tr: Transaction) => void }) => {
    compositionEvent = false
    view.dispatch(view.state.tr.setMeta(pluginKey, null))
    return false
  }

  return new Plugin<PendingMarks | null>({
    key: pluginKey,
    state: {
      init: () => null,
      apply: (transaction, pending) => applyPendingMarks(transaction, pending, compositionEvent),
    },
    props: {
      handleDOMEvents: {
        compositionstart: startCompositionEvent,
        compositionupdate: startCompositionEvent,
        compositionend: startCompositionEvent,
        blur: clearPendingMarks,
        pointerdown: clearPendingMarks,
      },
    },
    appendTransaction: appendPendingMarks,
    view: () => ({ destroy: () => clearTimeout(compositionTimeout) }),
  })
}
