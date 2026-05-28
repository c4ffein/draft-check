import { type LineEdit, type LocateOk, locateAll, numberLines } from "./locate"
import type { Suggestion } from "./types"

const API_URL = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-opus-4-8"
const MAX_RETRIES = 2

const TOOL = {
  name: "propose_edits",
  description:
    "Propose surgical edits to the user's text. Each edit identifies a line and the substring on that line to replace.",
  input_schema: {
    type: "object" as const,
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer", description: "1-indexed line number in the original text." },
            find: {
              type: "string",
              description:
                "Exact substring to locate on that line; must be unique within the line. For insertions, expand `find` to include surrounding anchor text.",
            },
            replacement: { type: "string", description: "Text to replace `find` with. Empty string = deletion." },
            rationale: { type: "string", description: "One short sentence explaining the fix." },
            category: {
              type: "string",
              enum: ["grammar", "clarity", "tone", "concision", "style"],
            },
          },
          required: ["line", "find", "replacement", "rationale", "category"],
        },
      },
    },
    required: ["edits"],
  },
}

type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: { edits: LineEdit[] } }
type TextBlock = { type: "text"; text: string }
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
type AssistantContent = TextBlock | ToolUseBlock
type UserContent = string | (TextBlock | ToolResultBlock)[]
type Message = { role: "user"; content: UserContent } | { role: "assistant"; content: AssistantContent[] }
type MessageResponse = { content: AssistantContent[]; stop_reason: string }

async function sendMessage(
  apiKey: string,
  systemPrompt: string,
  messages: Message[],
  signal: AbortSignal,
): Promise<MessageResponse> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "propose_edits" },
      messages,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as MessageResponse
}

export async function fetchSuggestions(
  apiKey: string,
  systemPrompt: string,
  text: string,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const numbered = numberLines(text)
  const messages: Message[] = [
    {
      role: "user",
      content: `Here is the text to review. Line numbers are shown for reference only — do not include the "N: " prefix in your edits.\n\n--- BEGIN TEXT ---\n${numbered}\n--- END TEXT ---`,
    },
  ]

  const allLocated: LocateOk[] = []

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await sendMessage(apiKey, systemPrompt, messages, signal)
    const toolUse = resp.content.find((b): b is ToolUseBlock => b.type === "tool_use" && b.name === "propose_edits")
    if (!toolUse) break

    const { located, failed } = locateAll(text, toolUse.input.edits)
    allLocated.push(...located)

    if (failed.length === 0 || attempt === MAX_RETRIES) break

    messages.push({ role: "assistant", content: resp.content })
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: buildRetryMessage(located.length, failed),
        },
      ],
    })
  }

  return allLocated.map(toSuggestion)
}

function buildRetryMessage(successCount: number, failed: { error: string; edit: LineEdit }[]): string {
  const header =
    successCount > 0
      ? `${successCount} edit(s) were located and accepted. ${failed.length} could not be applied:`
      : `${failed.length} edit(s) could not be applied:`
  const items = failed.map(
    (f, i) => `${i + 1}. line ${f.edit.line}, find=${JSON.stringify(f.edit.find)} — ${f.error}`,
  )
  const footer =
    `Call propose_edits again with ONLY corrected versions of these failed edits. ` +
    `Do not resubmit the ones that already succeeded.`
  return [header, ...items, footer].join("\n")
}

function toSuggestion(loc: LocateOk): Suggestion {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    start: loc.start,
    end: loc.end,
    replacement: loc.edit.replacement,
    originalSnippet: loc.edit.find,
    rationale: loc.edit.rationale,
    category: loc.edit.category,
    state: "pending" as const,
  }
}
