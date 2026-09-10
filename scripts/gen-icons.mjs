// Generates the extension icons (tile grid + bookmark ribbon on the Aurora
// gradient) as PNGs — no dependencies, pure Node. Renders supersampled at
// 384px and box-downsamples to 128/96/48/32.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const S = 384
const px = new Float64Array(S * S * 4) // rgba 0..255 premixed

const lerp = (a, b, t) => a + (b - a) * t
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const C0 = hex('#16A08C'), C1 = hex('#2E5E9E'), C2 = hex('#5B45C9')

function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx, dy = y - cy
  return dx * dx + dy * dy <= r * r
}
function blend(i, r, g, b, a) {
  px[i] = lerp(px[i], r, a)
  px[i + 1] = lerp(px[i + 1], g, a)
  px[i + 2] = lerp(px[i + 2], b, a)
  px[i + 3] = Math.max(px[i + 3], a * 255)
}

const s = S / 128
const T = 34 * s, gap = 10 * s, ox = (S - (2 * T + gap)) / 2, oy = ox, tr = 9 * s
const bx = ox + T + gap + 5 * s, by = oy - 4 * s, bw = T - 10 * s, bh = T + 12 * s, notch = 10 * s, bcx = bx + bw / 2

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    if (!inRounded(x, y, 0, 0, S - 1, S - 1, 28 * s)) continue // transparent corner
    // gradient background
    const t = (x + y) / (2 * S)
    let r, g, b
    if (t < 0.55) {
      const k = t / 0.55
      r = lerp(C0[0], C1[0], k); g = lerp(C0[1], C1[1], k); b = lerp(C0[2], C1[2], k)
    } else {
      const k = (t - 0.55) / 0.45
      r = lerp(C1[0], C2[0], k); g = lerp(C1[1], C2[1], k); b = lerp(C1[2], C2[2], k)
    }
    // soft glow top-left
    const gd = Math.hypot(x - 60, y - 48)
    const glow = Math.max(0, 1 - gd / 340) * 0.20
    r = lerp(r, 255, glow); g = lerp(g, 255, glow); b = lerp(b, 255, glow)
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
    // three white tiles
    const tiles = [[ox, oy], [ox, oy + T + gap], [ox + T + gap, oy + T + gap]]
    for (const [tx, ty] of tiles)
      if (inRounded(x, y, tx, ty, tx + T, ty + T, tr)) blend(i, 255, 255, 255, 0.96)
    // gold bookmark ribbon (rounded top, notched bottom)
    if (inRounded(x, y, bx, by, bx + bw, by + bh + 1000, 5 * s) && y <= by + bh) {
      const yn = by + bh - notch
      const inNotch = y > yn && Math.abs(x - bcx) <= ((y - yn) / notch) * (bw / 2)
      if (!inNotch) blend(i, 255, 209, 102, 1)
    }
  }
}

/* ---- PNG encoding ---- */
const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
const crc32 = (buf) => {
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function downsample(size) {
  const f = S / size
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * S + x * f + dx) * 4
          const al = px[i + 3] / 255
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += px[i + 3]
        }
      const n = f * f, o = (y * size + x) * 4
      const am = a / n / 255
      out[o] = am > 0 ? Math.round(r / n / am) : 0
      out[o + 1] = am > 0 ? Math.round(g / n / am) : 0
      out[o + 2] = am > 0 ? Math.round(b / n / am) : 0
      out[o + 3] = Math.round(a / n)
    }
  return out
}

mkdirSync('public/icons', { recursive: true })
for (const size of [128, 96, 48, 32]) {
  writeFileSync(`public/icons/${size}.png`, encodePNG(size, downsample(size)))
  console.log(`public/icons/${size}.png`)
}
