/* Capture pipeline: grab the LIVE page from the tab the user is reading
   (so paywalled / JS-rendered content extracts correctly), run Mozilla's
   Readability over it, build a local extractive summary, and pick the
   article's best images. */

import { Readability } from '@mozilla/readability'
import { type SaveInput } from './notion'

interface PageGrab {
  html: string
  url: string
  title: string
  ogImage?: string
  images: Array<{ src: string; w: number; h: number }>
}

/* Runs INSIDE the page (serialized function — no outer-scope references). */
function grabPage(): {
  html: string
  url: string
  title: string
  ogImage?: string
  images: Array<{ src: string; w: number; h: number }>
} {
  const images = Array.from(document.images)
    .filter((i) => i.naturalWidth >= 200 && i.naturalHeight >= 120)
    .slice(0, 40)
    .map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }))
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? undefined
  return {
    html: document.documentElement.outerHTML.slice(0, 2_500_000),
    url: location.href,
    title: document.title,
    ogImage: og,
    images,
  }
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 400)
}

/** Small extractive summary: frequent-word scoring with a position bonus. */
export function summarize(text: string, maxSentences = 4): string {
  const sents = sentences(text)
  if (sents.length <= maxSentences) return sents.join(' ')
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [])
    freq.set(w, (freq.get(w) ?? 0) + 1)
  const scored = sents.map((s, i) => {
    let score = 0
    for (const w of s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) score += freq.get(w) ?? 0
    score /= Math.max(8, s.length / 6) // normalize by length
    if (i < 3) score *= 1.5 // lead bonus
    return { s, i, score }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ')
}

const STOPWORDS = new Set(
  'about above after again their there these those which while would could should percent among between through during before other others because against including something anything everything'.split(' '),
)
/** Cheap topic tags for the no-AI fallback: domain + most frequent long words. */
export function keywordTags(text: string, domain: string): string[] {
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []) {
    if (STOPWORDS.has(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  const top = [...freq.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1))
  return [domain, ...top]
}

function absolutize(src: string, base: string): string | null {
  try {
    const u = new URL(src, base)
    return /^https?:$/.test(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

function pickImages(grab: PageGrab, articleHtml: string | null): string[] {
  const sizeByUrl = new Map(grab.images.map((i) => [i.src, i.w * i.h]))
  const ordered: string[] = []
  const push = (raw: string | null | undefined): void => {
    if (!raw) return
    const abs = absolutize(raw, grab.url)
    if (abs && !ordered.includes(abs)) ordered.push(abs)
  }
  push(grab.ogImage)
  if (articleHtml) {
    const doc = new DOMParser().parseFromString(articleHtml, 'text/html')
    for (const img of Array.from(doc.querySelectorAll('img'))) push(img.getAttribute('src'))
  }
  for (const i of [...grab.images].sort((a, b) => b.w * b.h - a.w * a.h)) push(i.src)
  // prefer images we know are big; keep unknown-size ones only if from the article
  return ordered
    .filter((u, idx) => idx < 2 || (sizeByUrl.get(u) ?? 0) >= 200 * 120)
    .slice(0, 5)
}

/** Full pipeline for one tab. Returns what should be written to Notion. */
export async function captureTab(tabId: number): Promise<SaveInput | string> {
  let grab: PageGrab | undefined
  try {
    const results = await browser.scripting.executeScript({ target: { tabId }, func: grabPage })
    grab = results[0]?.result
  } catch {
    return 'Could not read this page (Firefox blocks extensions on some internal pages).'
  }
  if (!grab || !/^https?:/.test(grab.url)) return 'This page can\'t be captured.'

  let article: {
    title?: string | null
    byline?: string | null
    excerpt?: string | null
    textContent?: string | null
    content?: string | null
  } | null = null
  try {
    const doc = new DOMParser().parseFromString(grab.html, 'text/html')
    const base = doc.createElement('base')
    base.href = grab.url
    doc.head.appendChild(base)
    article = new Readability(doc).parse()
  } catch {
    article = null
  }

  const text = article?.textContent?.trim() ?? ''
  const summary = text ? summarize(text) : ''
  return {
    title: article?.title || grab.title || grab.url,
    url: grab.url,
    summary,
    fullText: text || undefined,
    excerpt: article?.excerpt ?? undefined,
    byline: article?.byline ?? undefined,
    images: pickImages(grab, article?.content ?? null),
    domain: new URL(grab.url).host.replace(/^www\./, ''),
    tags: keywordTags(text, new URL(grab.url).host.replace(/^www\./, '')),
  }
}
