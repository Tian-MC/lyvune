import legacyThemes from '../themes'
import { contrast, luminance, mix, withAlpha } from './color'

// Compatibility for the community themes of the previous UI.
//
// The redesigned interface is dark-only and built on design tokens, so a
// legacy theme can only be honoured through its palette:
// - "successor": Dark and Extra Dark became the two official variants
// - "tinted": dark themes keep their accent colour and surfaces
// - "unsupported": light themes; Lyvune is used and the UI says so
// The legacy definitions themselves are untouched (src/themes/).

const BRAND = '#1faf8b'
const DEFAULT_BG = '#0a1110'
const WHITE = '#ffffff'
const BLACK = '#000000'
const TEXT = '#ddfbf1'

const SUCCESSORS = {
  DarkTheme: 'NavidromeTheme',
  ExtraDarkTheme: 'NavidromeOledTheme',
}

const isHex = (v) => typeof v === 'string' && /^#([0-9a-f]{3}){1,2}$/i.test(v)

// Nudges `color` towards `target` until it reaches `ratio` against `bg`
const ensureContrast = (color, bg, ratio, target) => {
  let c = color
  for (let i = 1; i <= 10 && contrast(c, bg) < ratio; i++) {
    c = mix(color, target, i / 10)
  }
  return c
}

// Lightest-touch secondary text that still reaches `ratio` on the surface
// where metadata sits (cards are lighter than the page background).
const readable = (surface, ratio) => {
  for (let a = 0.5; a <= 1; a += 0.02) {
    const c = mix(surface, TEXT, a)
    if (contrast(c, surface) >= ratio) return c
  }
  return TEXT
}

/** Token overrides derived from an accent and a background colour. */
export const computeTint = (accent, bg) => {
  const textOnAccent = contrast(accent, WHITE) >= 3 ? WHITE : BLACK
  const solid =
    textOnAccent === WHITE ? ensureContrast(accent, WHITE, 4.5, BLACK) : accent
  const surface2 = mix(bg, WHITE, 0.07)
  return {
    accent: accent,
    accentHover: mix(accent, WHITE, 0.15),
    accentSolid: solid,
    accentSolidHover: mix(solid, WHITE, 0.08),
    accentSoftHover: withAlpha(accent, 0.2),
    accentBorder: withAlpha(accent, 0.5),
    text2: readable(surface2, 7),
    text3: readable(surface2, 4.5),
    surface3Hover: mix(bg, WHITE, 0.15),
    accentText: ensureContrast(accent, bg, 4.5, WHITE),
    accentSoft: withAlpha(accent, 0.14),
    accentSofter: withAlpha(accent, 0.08),
    accentGlow: withAlpha(accent, 0.35),
    textOnAccent,
    bgApp: bg,
    bgSidebar: mix(bg, BLACK, 0.3),
    bgElevated: mix(bg, WHITE, 0.03),
    surface1: mix(bg, WHITE, 0.04),
    surface2,
    surface3: mix(bg, WHITE, 0.11),
  }
}

/** CSS custom properties (design/tokens.css) for a tint. */
export const tintCssVars = (tint) => ({
  '--accent': tint.accent,
  '--accent-hover': tint.accentHover,
  '--accent-solid': tint.accentSolid,
  '--accent-solid-hover': tint.accentSolidHover,
  '--accent-text': tint.accentText,
  '--accent-soft': tint.accentSoft,
  '--accent-softer': tint.accentSofter,
  '--accent-glow': tint.accentGlow,
  '--text-on-accent': tint.textOnAccent,
  '--text-2': tint.text2,
  '--text-3': tint.text3,
  '--bg-app': tint.bgApp,
  '--bg-sidebar': tint.bgSidebar,
  '--bg-elevated': tint.bgElevated,
  '--surface-1': tint.surface1,
  '--surface-2': tint.surface2,
  '--surface-3': tint.surface3,
})

const describe = (id) => {
  const theme = legacyThemes[id]
  if (!theme) return null
  const name = theme.themeName || id
  if (SUCCESSORS[id]) {
    return { id, name, support: 'successor', successor: SUCCESSORS[id] }
  }
  const p = theme.palette || {}
  if (p.type !== 'dark') return { id, name, support: 'unsupported' }

  const rawBg = p.background?.default
  // A light or missing background would break the dark-only components
  const bg = isHex(rawBg) && luminance(rawBg) < 0.06 ? rawBg : DEFAULT_BG
  const rawAccent = typeof p.primary === 'object' ? p.primary.main : null
  // An accent that disappears against the background is not usable
  const accent =
    isHex(rawAccent) && contrast(rawAccent, bg) >= 3 ? rawAccent : BRAND
  return { id, name, support: 'tinted', tint: computeTint(accent, bg) }
}

export const legacyThemeIds = Object.keys(legacyThemes)

const cache = new Map()

/** Support level and tint of a legacy theme id, or null if unknown. */
export const describeLegacyTheme = (id) => {
  if (!cache.has(id)) cache.set(id, describe(id))
  return cache.get(id)
}

/** Legacy id whose theme name matches the server's DefaultTheme setting. */
export const legacyIdByName = (name) =>
  legacyThemeIds.find((id) => legacyThemes[id].themeName === name)
