import { describe, expect, test } from "bun:test"
import { applySuggestion, markAllObsolete, overlaps, rejectSuggestion } from "./offsets"
import type { Suggestion, SuggestionState } from "./types"

// Helper: build a Suggestion whose originalSnippet is derived from the given text.
// This mirrors what the locator does in production, so applySuggestion's post-apply
// validation passes for correctly-shaped fixtures.
function s(
  text: string,
  id: string,
  start: number,
  end: number,
  replacement: string,
  state: SuggestionState = "pending",
): Suggestion {
  return {
    id,
    start,
    end,
    replacement,
    originalSnippet: text.slice(start, end),
    rationale: "",
    category: "grammar",
    state,
  }
}

// ─── overlaps ──────────────────────────────────────────────────────────────────

describe("overlaps", () => {
  test("disjoint ranges do not overlap", () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false)
    expect(overlaps({ start: 0, end: 5 }, { start: 10, end: 15 })).toBe(false)
  })

  test("intersecting ranges overlap", () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 3, end: 8 })).toBe(true)
    expect(overlaps({ start: 0, end: 10 }, { start: 3, end: 5 })).toBe(true)
  })

  test("fully nested ranges overlap", () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 4, end: 6 })).toBe(true)
    expect(overlaps({ start: 4, end: 6 }, { start: 0, end: 10 })).toBe(true)
  })

  test("identical ranges overlap", () => {
    expect(overlaps({ start: 3, end: 7 }, { start: 3, end: 7 })).toBe(true)
  })

  test("touching but not overlapping ranges", () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false)
    expect(overlaps({ start: 5, end: 10 }, { start: 0, end: 5 })).toBe(false)
  })

  test("pure insertion strictly inside a span counts as overlap", () => {
    expect(overlaps({ start: 3, end: 3 }, { start: 0, end: 5 })).toBe(true)
    expect(overlaps({ start: 0, end: 5 }, { start: 3, end: 3 })).toBe(true)
  })

  test("pure insertion at boundary does not overlap", () => {
    expect(overlaps({ start: 5, end: 5 }, { start: 0, end: 5 })).toBe(false)
    expect(overlaps({ start: 0, end: 0 }, { start: 0, end: 5 })).toBe(false)
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 5 })).toBe(false)
    expect(overlaps({ start: 0, end: 5 }, { start: 0, end: 0 })).toBe(false)
  })

  test("two pure insertions overlap only at the same point", () => {
    expect(overlaps({ start: 3, end: 3 }, { start: 3, end: 3 })).toBe(true)
    expect(overlaps({ start: 3, end: 3 }, { start: 4, end: 4 })).toBe(false)
  })

  test("symmetry: order of arguments must not matter", () => {
    const cases: [{ start: number; end: number }, { start: number; end: number }][] = [
      [{ start: 0, end: 5 }, { start: 3, end: 8 }],
      [{ start: 0, end: 10 }, { start: 4, end: 6 }],
      [{ start: 3, end: 3 }, { start: 0, end: 5 }],
      [{ start: 5, end: 5 }, { start: 0, end: 5 }],
      [{ start: 0, end: 5 }, { start: 5, end: 10 }],
    ]
    for (const [a, b] of cases) {
      expect(overlaps(a, b)).toBe(overlaps(b, a))
    }
  })
})

// ─── applySuggestion: text mutation ────────────────────────────────────────────

describe("applySuggestion — text", () => {
  const text = "the cat sat on the mat"
  //            0123456789012345678901
  //            0         1         2

  test("replacement", () => {
    const a = s(text, "a", 4, 7, "dog")
    expect(applySuggestion(text, a, [a]).text).toBe("the dog sat on the mat")
  })

  test("pure deletion (empty replacement)", () => {
    const a = s(text, "a", 3, 7, "") // delete " cat"
    expect(applySuggestion(text, a, [a]).text).toBe("the sat on the mat")
  })

  test("pure insertion (zero-width span)", () => {
    const a = s(text, "a", 4, 4, "big ")
    expect(applySuggestion(text, a, [a]).text).toBe("the big cat sat on the mat")
  })

  test("insertion at start of text", () => {
    const a = s(text, "a", 0, 0, "Hey, ")
    expect(applySuggestion(text, a, [a]).text).toBe("Hey, the cat sat on the mat")
  })

  test("insertion at end of text", () => {
    const a = s(text, "a", text.length, text.length, ".")
    expect(applySuggestion(text, a, [a]).text).toBe("the cat sat on the mat.")
  })

  test("replacement spanning the entire text", () => {
    const a = s(text, "a", 0, text.length, "rewritten")
    expect(applySuggestion(text, a, [a]).text).toBe("rewritten")
  })

  test("idempotent replacement (same string)", () => {
    const a = s(text, "a", 4, 7, "cat")
    expect(applySuggestion(text, a, [a]).text).toBe(text)
  })
})

// ─── applySuggestion: offset arithmetic on other suggestions ──────────────────

describe("applySuggestion — offsets", () => {
  const text = "the cat sat on the mat"

  test("equal-length replacement leaves later offsets unchanged", () => {
    const a = s(text, "a", 4, 7, "dog")
    const b = s(text, "b", 19, 22, "rug")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([19, 22])
  })

  test("positive delta shifts later suggestions forward", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const b = s(text, "b", 19, 22, "rug")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([21, 24])
  })

  test("negative delta shifts later suggestions backward", () => {
    const a = s(text, "a", 4, 7, "x")
    const b = s(text, "b", 19, 22, "rug")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([17, 20])
  })

  test("multiple later suggestions all shift by the same delta", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const later = [s(text, "x", 8, 11, "ran"), s(text, "y", 12, 14, "in"), s(text, "z", 19, 22, "rug")]
    const out = applySuggestion(text, a, [a, ...later]).suggestions
    expect(out.find((x) => x.id === "x")).toMatchObject({ start: 10, end: 13 })
    expect(out.find((x) => x.id === "y")).toMatchObject({ start: 14, end: 16 })
    expect(out.find((x) => x.id === "z")).toMatchObject({ start: 21, end: 24 })
  })

  test("suggestions strictly before the edit are untouched", () => {
    const a = s(text, "a", 19, 22, "rug")
    const b = s(text, "b", 4, 7, "dog")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([4, 7])
  })

  test("suggestion ending exactly at applied.start is untouched", () => {
    const a = s(text, "a", 4, 7, "WHATEVER")
    const b = s(text, "b", 0, 4, "THE ")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("pending")
    expect([after.start, after.end]).toEqual([0, 4])
  })

  test("suggestion starting exactly at applied.end is shifted but not superseded", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const b = s(text, "b", 7, 10, "RAN")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("pending")
    expect([after.start, after.end]).toEqual([9, 12])
  })

  test("two-step apply: indices computed from first apply are correct for second", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const b = s(text, "b", 19, 22, "rug")
    const step1 = applySuggestion(text, a, [a, b])
    expect(step1.text).toBe("the puppy sat on the mat")
    const updatedB = step1.suggestions.find((x) => x.id === "b")!
    const step2 = applySuggestion(step1.text, updatedB, step1.suggestions)
    expect(step2.text).toBe("the puppy sat on the rug")
  })

  test("insertion shifts later suggestions by replacement length", () => {
    const a = s(text, "a", 4, 4, "big ")
    const b = s(text, "b", 19, 22, "rug")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([23, 26])
  })
})

// ─── applySuggestion: state transitions ────────────────────────────────────────

describe("applySuggestion — state", () => {
  const text = "the cat sat on the mat"

  test("applied suggestion is marked applied", () => {
    const a = s(text, "a", 4, 7, "dog")
    const out = applySuggestion(text, a, [a]).suggestions
    expect(out[0].state).toBe("applied")
  })

  test("overlapping pending suggestions are marked superseded", () => {
    const a = s(text, "a", 4, 7, "dog")
    const b = s(text, "b", 5, 8, "rat")
    const out = applySuggestion(text, a, [a, b]).suggestions
    expect(out.find((x) => x.id === "b")!.state).toBe("superseded")
  })

  test("superseded suggestion keeps its original offsets", () => {
    const a = s(text, "a", 4, 7, "dog")
    const b = s(text, "b", 5, 8, "rat")
    const out = applySuggestion(text, a, [a, b]).suggestions
    const sup = out.find((x) => x.id === "b")!
    expect([sup.start, sup.end]).toEqual([5, 8])
  })

  test("nested suggestion (b strictly inside a) is superseded", () => {
    const a = s(text, "a", 4, 10, "REPLACED")
    const b = s(text, "b", 5, 7, "x")
    expect(applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!.state).toBe("superseded")
  })

  test("rejected suggestion stays rejected and is not shifted", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const b = s(text, "b", 19, 22, "rug", "rejected")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("rejected")
    expect([after.start, after.end]).toEqual([19, 22])
  })

  test("already-applied suggestion is not re-applied and not shifted", () => {
    const a = s(text, "a", 4, 7, "puppy")
    const b = s(text, "b", 19, 22, "rug", "applied")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("applied")
    expect([after.start, after.end]).toEqual([19, 22])
  })

  test("obsolete suggestion is left alone (not superseded, not shifted)", () => {
    const a = s(text, "a", 4, 7, "dog")
    const b = s(text, "b", 5, 8, "rat", "obsolete")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("obsolete")
    expect([after.start, after.end]).toEqual([5, 8])
  })

  test("stale suggestion is left alone (not superseded, not shifted)", () => {
    const a = s(text, "a", 4, 7, "dog")
    const b = s(text, "b", 5, 8, "rat", "stale")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("stale")
    expect([after.start, after.end]).toEqual([5, 8])
  })

  test("applied suggestion does not appear as superseded even if listed twice (defensive)", () => {
    const a = s(text, "a", 4, 7, "dog")
    const out = applySuggestion(text, a, [a, a]).suggestions
    expect(out.every((x) => x.state === "applied")).toBe(true)
  })
})

// ─── applySuggestion: post-apply validation (defensive against drift) ──────────

describe("applySuggestion — post-apply validation", () => {
  const text = "the cat sat on the mat"

  test("non-overlapping shift validates and stays pending (no false stale)", () => {
    const a = s(text, "a", 4, 7, "puppy") // delta +2
    const b = s(text, "b", 19, 22, "rug")
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("pending")
  })

  test("when originalSnippet no longer matches the shifted span, the suggestion is marked stale", () => {
    // Construct a suggestion whose originalSnippet is intentionally wrong to simulate
    // drift (e.g., a future bug in the shift math, or unicode width disagreement).
    const a = s(text, "a", 4, 7, "puppy")
    const b: Suggestion = { ...s(text, "b", 19, 22, "rug"), originalSnippet: "DRIFTED" }
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("stale")
  })

  test("stale-by-validation keeps its (shifted) offsets so the UI can still display it", () => {
    const a = s(text, "a", 4, 7, "puppy") // delta +2
    const b: Suggestion = { ...s(text, "b", 19, 22, "rug"), originalSnippet: "DRIFTED" }
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect([after.start, after.end]).toEqual([21, 24])
  })

  test("validation runs on un-shifted (before-the-edit) suggestions too", () => {
    const a = s(text, "a", 19, 22, "rug") // edit at the end
    const b: Suggestion = { ...s(text, "b", 4, 7, "dog"), originalSnippet: "DRIFTED" } // before
    const after = applySuggestion(text, a, [a, b]).suggestions.find((x) => x.id === "b")!
    expect(after.state).toBe("stale")
  })
})

// ─── rejectSuggestion ──────────────────────────────────────────────────────────

describe("rejectSuggestion", () => {
  const text = "abcde"

  test("marks the given id rejected", () => {
    const a = s(text, "a", 0, 1, "x")
    const b = s(text, "b", 2, 3, "y")
    const out = rejectSuggestion("a", [a, b])
    expect(out.find((x) => x.id === "a")!.state).toBe("rejected")
    expect(out.find((x) => x.id === "b")!.state).toBe("pending")
  })

  test("does not touch offsets", () => {
    const a = s("the cat sat on the mat", "a", 4, 7, "dog")
    const out = rejectSuggestion("a", [a])
    expect([out[0].start, out[0].end]).toEqual([4, 7])
  })

  test("unknown id is a no-op", () => {
    const a = s(text, "a", 0, 1, "x")
    const out = rejectSuggestion("nope", [a])
    expect(out).toEqual([a])
  })

  test("already-rejected stays rejected", () => {
    const a = s(text, "a", 0, 1, "x", "rejected")
    expect(rejectSuggestion("a", [a])[0].state).toBe("rejected")
  })

  test("empty list returns empty list", () => {
    expect(rejectSuggestion("a", [])).toEqual([])
  })
})

// ─── markAllObsolete ───────────────────────────────────────────────────────────

describe("markAllObsolete", () => {
  const text = "abcdefghij"

  test("pending → obsolete", () => {
    const a = s(text, "a", 0, 1, "x")
    expect(markAllObsolete([a])[0].state).toBe("obsolete")
  })

  test("non-pending states are preserved (including stale)", () => {
    const list: Suggestion[] = [
      s(text, "a", 0, 1, "x", "pending"),
      s(text, "b", 2, 3, "y", "applied"),
      s(text, "c", 4, 5, "z", "rejected"),
      s(text, "d", 6, 7, "w", "superseded"),
      s(text, "e", 8, 9, "v", "stale"),
      s(text, "f", 9, 10, "u", "obsolete"),
    ]
    const out = markAllObsolete(list)
    expect(out.find((x) => x.id === "a")!.state).toBe("obsolete")
    expect(out.find((x) => x.id === "b")!.state).toBe("applied")
    expect(out.find((x) => x.id === "c")!.state).toBe("rejected")
    expect(out.find((x) => x.id === "d")!.state).toBe("superseded")
    expect(out.find((x) => x.id === "e")!.state).toBe("stale")
    expect(out.find((x) => x.id === "f")!.state).toBe("obsolete")
  })

  test("does not touch offsets", () => {
    const a = s("the cat sat on the mat", "a", 4, 7, "dog")
    const out = markAllObsolete([a])
    expect([out[0].start, out[0].end]).toEqual([4, 7])
  })

  test("empty list returns empty list", () => {
    expect(markAllObsolete([])).toEqual([])
  })
})

// ─── unicode: documents current UTF-16 code-unit behavior ──────────────────────

describe("applySuggestion — unicode / UTF-16", () => {
  test("BMP-only text behaves as expected (1 code unit per char)", () => {
    const text = "héllo wörld"
    const a = s(text, "a", 6, 11, "Wörld")
    expect(applySuggestion(text, a, [a]).text).toBe("héllo Wörld")
  })

  test("emoji outside the BMP occupies 2 UTF-16 code units", () => {
    const text = "hi 😀 there"
    expect(text.length).toBe(11) // emoji is 2 code units, so 2+1+2+1+5 = 11
    const a = s(text, "a", 3, 5, "🎉")
    expect(applySuggestion(text, a, [a]).text).toBe("hi 🎉 there")
  })
})
