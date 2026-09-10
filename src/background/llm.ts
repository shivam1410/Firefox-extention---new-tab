/* Optional AI summaries via OpenRouter (user-supplied key, any model).
   The article text is extracted locally first (Readability); only that clean
   text — never cookies or credentials — is sent to the chosen model. On any
   failure the caller falls back to the local extractive summary. */

export interface OpenRouterConfig {
  key: string
  model: string
}

export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'

const SYSTEM_PROMPT =
  'You summarize web articles for a personal read-it-later archive. Be faithful to the text; no invented facts; no preamble.'
const userPrompt = (title: string, url: string, article: string): string =>
  `Title: ${title}\nURL: ${url}\n\nArticle:\n${article}\n\nWrite a crisp summary: one paragraph of 3–5 sentences, then exactly 3 key takeaways as short bullet lines, each starting with "- ". Finally, on its own last line, write: TAGS: tag1, tag2, tag3 — with 2 to 4 short topic tags (1–2 words each).`

export interface LlmResult {
  summary: string
  tags: string[]
}
/** Splits the model output into summary text and the trailing TAGS line. */
function parseLlmOutput(raw: string): LlmResult {
  const lines = raw.trim().split('\n')
  const tags: string[] = []
  const kept: string[] = []
  for (const line of lines) {
    const m = /^\s*\**\s*TAGS\s*:\s*(.+)$/i.exec(line)
    if (m && m[1]) {
      tags.push(
        ...m[1]
          .split(/[,;]/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter((t) => t.length > 1 && t.length < 40),
      )
    } else {
      kept.push(line)
    }
  }
  return { summary: kept.join('\n').trim(), tags: tags.slice(0, 4) }
}

/** Direct Anthropic API (used automatically for sk-ant-… keys). */
async function anthropicSummarize(cfg: OpenRouterConfig, title: string, url: string, article: string): Promise<LlmResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model && !cfg.model.includes('/') ? cfg.model : DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt(title, url, article) }],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
    const out = body.content?.find((c) => c.type === 'text')?.text?.trim()
    return out && out.length > 40 ? parseLlmOutput(out) : null
  } catch {
    return null
  }
}

export async function getOpenRouterConfig(): Promise<OpenRouterConfig | null> {
  const box = await browser.storage.local.get('openrouterCfg')
  const cfg = box['openrouterCfg'] as OpenRouterConfig | undefined
  return cfg?.key ? cfg : null
}
export async function setOpenRouterConfig(cfg: OpenRouterConfig | null): Promise<void> {
  if (cfg?.key) await browser.storage.local.set({ openrouterCfg: cfg })
  else await browser.storage.local.remove('openrouterCfg')
}

/** Returns an AI summary + topic tags, or null to fall back to local extraction. */
export async function llmSummarize(title: string, url: string, text: string): Promise<LlmResult | null> {
  const cfg = await getOpenRouterConfig()
  if (!cfg || text.length < 400) return null
  const article = text.slice(0, 14_000)
  if (cfg.key.startsWith('sk-ant-')) return anthropicSummarize(cfg, title, url, article)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Library Tab',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(title, url, article) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const out = body.choices?.[0]?.message?.content?.trim()
    return out && out.length > 40 ? parseLlmOutput(out) : null
  } catch {
    return null
  }
}
