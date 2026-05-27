import { describe, expect, test } from "bun:test"
import { type LineEdit, locateAll, locateEdit, numberLines } from "./locate"

function e(line: number, find: string, replacement = ""): LineEdit {
  return { line, find, replacement, rationale: "", category: "grammar" }
}

// ─── numberLines ──────────────────────────────────────────────────────────────

describe("numberLines", () => {
  test("single line", () => {
    expect(numberLines("hello")).toBe("1: hello")
  })

  test("multiple lines, right-padded line numbers", () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n")
    const out = numberLines(text).split("\n")
    expect(out[0]).toBe(" 1: line 1")
    expect(out[11]).toBe("12: line 12")
  })

  test("preserves empty lines", () => {
    expect(numberLines("a\n\nb")).toBe("1: a\n2: \n3: b")
  })

  test("trailing newline produces a trailing empty line entry", () => {
    expect(numberLines("a\n")).toBe("1: a\n2: ")
  })
})

// ─── locateEdit: happy path ───────────────────────────────────────────────────

describe("locateEdit — happy path", () => {
  test("single occurrence on a single-line text", () => {
    const r = locateEdit("the cat sat on the mat", e(1, "cat"))
    expect(r).toMatchObject({ ok: true, start: 4, end: 7 })
  })

  test("locates on the first line of a multi-line text", () => {
    const r = locateEdit("hello\nworld\nbye", e(1, "hello"))
    expect(r).toMatchObject({ ok: true, start: 0, end: 5 })
  })

  test("locates on a middle line, offsets account for prior \\n chars", () => {
    const r = locateEdit("hello\nworld\nbye", e(2, "world"))
    // "hello" (5) + "\n" (1) = 6 → "world" at 6-11
    expect(r).toMatchObject({ ok: true, start: 6, end: 11 })
  })

  test("locates on the last line", () => {
    const r = locateEdit("hello\nworld\nbye", e(3, "bye"))
    expect(r).toMatchObject({ ok: true, start: 12, end: 15 })
  })

  test("locator returned offsets slice the original text correctly", () => {
    const text = "alpha\nbeta gamma delta\nepsilon"
    const r = locateEdit(text, e(2, "gamma"))
    expect(r.ok).toBe(true)
    if (r.ok) expect(text.slice(r.start, r.end)).toBe("gamma")
  })

  test("find can include leading/trailing whitespace", () => {
    const r = locateEdit("the cat sat", e(1, " cat "))
    expect(r).toMatchObject({ ok: true, start: 3, end: 8 })
  })

  test("find can be the whole line", () => {
    const r = locateEdit("foo\nbar\nbaz", e(2, "bar"))
    expect(r).toMatchObject({ ok: true, start: 4, end: 7 })
  })

  test("find on a line containing the same word elsewhere in the document still works (uniqueness is per-line)", () => {
    // "the" appears on both lines, but each line has only one occurrence
    const r = locateEdit("the cat\nthe dog", e(2, "the"))
    expect(r).toMatchObject({ ok: true, start: 8, end: 11 })
  })
})

// ─── locateEdit: failures ─────────────────────────────────────────────────────

describe("locateEdit — failures", () => {
  test("find not present on the requested line", () => {
    const r = locateEdit("the cat sat", e(1, "dog"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not found on line 1/)
  })

  test("find present in a different line is still a failure", () => {
    const r = locateEdit("the cat\nthe dog", e(1, "dog"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not found on line 1/)
  })

  test("find ambiguous (multiple occurrences on the line) is rejected with column hints", () => {
    const r = locateEdit("ha ha ha", e(1, "ha"))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/3 times/)
      expect(r.error).toMatch(/0, 3, 6/)
    }
  })

  test("line out of range (too high)", () => {
    const r = locateEdit("only one line", e(2, "one"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/out of range/)
  })

  test("line out of range (zero or negative)", () => {
    expect(locateEdit("foo", e(0, "foo")).ok).toBe(false)
    expect(locateEdit("foo", e(-1, "foo")).ok).toBe(false)
  })

  test("empty find is rejected (would otherwise match every position)", () => {
    const r = locateEdit("hello", e(1, ""))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must not be empty/)
  })

  test("error payload echoes the failing edit so the model can correct it", () => {
    const edit = e(1, "dog")
    const r = locateEdit("the cat sat", edit)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.edit).toBe(edit)
  })
})

// ─── overlapping-occurrence edge cases ────────────────────────────────────────

describe("locateEdit — overlapping search needles", () => {
  test("'aa' in 'aaaa' counts 3 overlapping matches (and is therefore ambiguous)", () => {
    const r = locateEdit("aaaa", e(1, "aa"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/3 times/)
  })

  test("uniqueness check is satisfied when there is exactly one (possibly self-overlapping) match", () => {
    const r = locateEdit("xaay", e(1, "aa"))
    expect(r).toMatchObject({ ok: true, start: 1, end: 3 })
  })
})

// ─── locateAll ────────────────────────────────────────────────────────────────

describe("locateAll", () => {
  test("partitions results into located / failed", () => {
    const text = "the cat sat on the mat"
    const edits = [e(1, "cat", "dog"), e(1, "missing"), e(1, "the")] // "the" appears twice → ambiguous
    const { located, failed } = locateAll(text, edits)
    expect(located).toHaveLength(1)
    expect(located[0].edit.find).toBe("cat")
    expect(failed).toHaveLength(2)
    expect(failed.map((f) => f.edit.find).sort()).toEqual(["missing", "the"])
  })

  test("empty input → empty partitions", () => {
    expect(locateAll("anything", [])).toEqual({ located: [], failed: [] })
  })
})
