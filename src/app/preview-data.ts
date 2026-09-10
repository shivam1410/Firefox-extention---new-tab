/* Sample trees shown when a live API isn't available (e.g. opening the
   built page in a plain browser during development) and for the sources
   that aren't wired to real storage yet (Library → P1, grid → P2). */

import { F, L, type TreeNode } from './model'

export const PREVIEW_LIBRARY: TreeNode[] = [
  F('Work', [
    F('Design', [
      L('Library Tab — mock', 'https://figma.com/file/lib-tab'),
      L('HighRise tokens', 'https://dribbble.com/shots/hr'),
      L('Wallpaper refs', 'https://unsplash.com/s/gradients'),
    ]),
    F('Specs', [
      L('PRD — Library Tab', 'https://notion.so/prd-library-tab'),
      L('Source adapter notes', 'https://notion.so/source-adapters'),
    ]),
    L('Team Grafana board', 'https://grafana.net/d/team'),
  ]),
  F('Reading List', [
    L('An ode to small software', 'https://blog.example.com/small-software'),
    L('IndexedDB in anger', 'https://web.dev/indexeddb'),
    L('Fractional indexing, explained', 'https://observablehq.com/fractional'),
  ]),
  L('MDN — WebExtensions', 'https://developer.mozilla.org/Add-ons'),
  L('Vite docs', 'https://vitejs.dev/guide'),
]

export const PREVIEW_TABS: TreeNode[] = [
  F('Window 1', [
    L('PR #4128 — library core', 'https://github.com/ghl/pull/4128', { when: 'open' }),
    L('Hacker News', 'https://news.ycombinator.com', { when: 'open' }),
  ]),
]

export const PREVIEW_BOOKMARKS: TreeNode[] = [
  F('Toolbar', [L('GitHub', 'https://github.com'), L('Linear', 'https://linear.app')], { locked: true }),
  F('Other Bookmarks', [L('Flight confirmation', 'https://airline.example.com/booking')], { locked: true }),
]

export const PREVIEW_HISTORY: TreeNode[] = [
  F('Today', [
    L('Firefox for Android — API differences', 'https://extensionworkshop.com/android', { when: '21:04' }),
    L('Hacker News', 'https://news.ycombinator.com', { when: '19:58' }),
  ]),
  F('By site', [F('github.com', [L('PR #4128 — library core', 'https://github.com/ghl/pull/4128', { when: 'Tue' })])]),
]

/* The new-tab grid — becomes a real Library folder in P1/P2. */
export const GRID: TreeNode[] = [
  L('GitHub', 'https://github.com', { hot: true }),
  L('Gmail', 'https://mail.google.com', { hot: true }),
  L('Figma', 'https://figma.com'),
  L('Hacker News', 'https://news.ycombinator.com'),
  L('Linear', 'https://linear.app'),
  L('YouTube', 'https://youtube.com'),
  F('Work', [
    L('Grafana', 'https://grafana.net'),
    L('Notion', 'https://notion.so'),
    L('Calendar', 'https://calendar.google.com'),
    L('Jenkins', 'https://jenkins.example.com'),
  ]),
]
