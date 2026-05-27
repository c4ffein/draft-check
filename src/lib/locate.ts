import type { Category } from "./types"

export type LineEdit = {
  line: number
  find: string
  replacement: string
  rationale: string
  category: Category
}

export type LocateOk = { ok: true; start: number; end: number; edit: LineEdit }
export type LocateErr = { ok: false; error: string; edit: LineEdit }
export type LocateResult = LocateOk | LocateErr

export function numberLines(text: string): string {
  const lines = text.split("\n")
  const width = String(lines.length).length
  return lines.map((l, i) => `${String(i + 1).padStart(width, " ")}: ${l}`).join("\n")
}

export function locateEdit(text: string, edit: LineEdit): LocateResult {
  if (edit.find === "") {
    return { ok: false, error: "find must not be empty — for insertions, include anchor text", edit }
  }

  const lines = text.split("\n")
  if (edit.line < 1 || edit.line > lines.length) {
    return { ok: false, error: `line ${edit.line} out of range (text has ${lines.length} line(s))`, edit }
  }

  const lineIdx = edit.line - 1
  const line = lines[lineIdx]

  let lineStart = 0
  for (let i = 0; i < lineIdx; i++) lineStart += lines[i].length + 1 // +1 for the \n

  const occurrences: number[] = []
  let from = 0
  while (from <= line.length) {
    const idx = line.indexOf(edit.find, from)
    if (idx === -1) break
    occurrences.push(idx)
    from = idx + 1
  }

  if (occurrences.length === 0) {
    return {
      ok: false,
      error: `find string ${JSON.stringify(edit.find)} not found on line ${edit.line} (line content: ${JSON.stringify(line)})`,
      edit,
    }
  }
  if (occurrences.length > 1) {
    return {
      ok: false,
      error: `find string ${JSON.stringify(edit.find)} matches ${occurrences.length} times on line ${edit.line} at columns ${occurrences.join(", ")}; include more surrounding text to disambiguate`,
      edit,
    }
  }

  const inLineOffset = occurrences[0]
  return {
    ok: true,
    start: lineStart + inLineOffset,
    end: lineStart + inLineOffset + edit.find.length,
    edit,
  }
}

export function locateAll(text: string, edits: LineEdit[]): { located: LocateOk[]; failed: LocateErr[] } {
  const located: LocateOk[] = []
  const failed: LocateErr[] = []
  for (const e of edits) {
    const r = locateEdit(text, e)
    if (r.ok) located.push(r)
    else failed.push(r)
  }
  return { located, failed }
}
