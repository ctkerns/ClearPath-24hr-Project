export type DiffPart = { text: string; kind: 'same' | 'removed' | 'added' }

/**
 * Word-level changes between two texts, with a longest-common-subsequence table.
 * Marketing fields are short, so the simple O(n·m) method is fast enough. Spaces are their own tokens.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/)
  const b = after.split(/(\s+)/)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])

  const parts: DiffPart[] = []
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ text, kind })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push(a[i++], 'removed')
    else push(b[j++], 'added')
  }
  while (i < a.length) push(a[i++], 'removed')
  while (j < b.length) push(b[j++], 'added')
  return parts
}
