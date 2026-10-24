// Colour helpers for artwork-derived ambience. The server computes a
// `dominantColor` for every artwork; these helpers tame it so it can light a
// background without ever competing with Navidrome Blue or hurting contrast.

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

export const hexToRgb = (hex) => {
  if (!hex || typeof hex !== 'string') return null
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const rgbToHsl = ({ r, g, b }) => {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

/**
 * Returns a softened ambient colour as an `H S% L%` triplet usable inside
 * `hsl(var(--ambient) / alpha)`. Saturation and lightness are bounded so that
 * neon covers stay elegant and white covers still produce a visible glow.
 */
export const ambientFrom = (hex, fallback = '212 30% 22%') => {
  const rgb = hexToRgb(hex)
  if (!rgb) return fallback
  const { h, s, l } = rgbToHsl(rgb)
  const sat = s < 0.08 ? s * 100 : clamp(s * 100, 18, 62)
  const light = clamp(l * 100, 20, 42)
  return `${Math.round(h)} ${Math.round(sat)}% ${Math.round(light)}%`
}

const toHex = ({ r, g, b }) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** Linear mix of two hex colours; `amount` of `b` into `a`. */
export const mix = (a, b, amount) => {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  if (!x || !y) return a
  return toHex({
    r: x.r + (y.r - x.r) * amount,
    g: x.g + (y.g - x.g) * amount,
    b: x.b + (y.b - x.b) * amount,
  })
}

const channel = (v) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const luminance = (hex) => {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  )
}

/** WCAG contrast ratio between two hex colours. */
export const contrast = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export const withAlpha = (hex, alpha) => {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : hex
}
