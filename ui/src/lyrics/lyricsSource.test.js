import { describe, it, expect } from 'vitest'
import {
  formatOffset,
  percent,
  providerName,
  qualityLabel,
  sourceLabel,
} from './lyricsSource'

// Interpolating stand-in for the translate function
const t = (key, fallback, opts = {}) =>
  fallback.replace(/%\{(\w+)\}/g, (_, k) => opts[k] ?? '')

describe('lyrics source wording', () => {
  it('names providers, falling back to the id', () => {
    expect(providerName('lrclib')).toBe('LRCLIB')
    expect(providerName('musixmatch')).toBe('Musixmatch')
    expect(providerName('something')).toBe('something')
    expect(providerName(undefined)).toBe('')
  })

  it('labels the quality levels', () => {
    expect(qualityLabel(t, 'karaoke')).toBe('Karaoke')
    expect(qualityLabel(t, 'synced')).toBe('Synced')
    expect(qualityLabel(t, 'plain')).toBe('Plain')
    expect(qualityLabel(t, 'none')).toBe('')
  })

  it.each([
    [{ source: 'sidecar', file: '01.lrc' }, 'Local file: 01.lrc'],
    [{ source: 'embedded' }, 'Embedded in the audio file'],
    [{ source: 'managed', provider: 'lrclib' }, 'Downloaded from LRCLIB'],
    [{ source: 'user', provider: 'lrclib' }, 'Chosen from LRCLIB'],
    [{ source: 'user', provider: 'import' }, 'Imported file'],
    [{ source: 'user', provider: 'embedded' }, 'Chosen from embedded'],
    [{ source: 'user' }, 'Chosen by you'],
    [{ source: 'remote', provider: 'myplugin' }, 'Plugin: myplugin'],
    [
      { id: 'plugin:myplugin', source: 'remote', provider: 'myplugin' },
      'Plugin: myplugin',
    ],
    [
      { id: 'display', source: 'remote', provider: 'kugou' },
      'Shown from KuGou Music · not saved',
    ],
    [{ source: 'unknown' }, ''],
  ])('describes %j', (info, expected) => {
    expect(sourceLabel(t, info)).toBe(expected)
  })

  it('says nothing without a source', () => {
    expect(sourceLabel(t, null)).toBe('')
  })

  it('formats offsets with their sign, positive meaning sooner', () => {
    expect(formatOffset(250)).toBe('+250 ms')
    expect(formatOffset(-100)).toBe('-100 ms')
    expect(formatOffset(0)).toBe('')
    expect(formatOffset(undefined)).toBe('')
  })

  it('formats a confidence as a percentage', () => {
    expect(percent(0.97)).toBe('97%')
    expect(percent(undefined)).toBe('0%')
  })
})
