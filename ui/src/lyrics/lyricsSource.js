// How the interface describes where lyrics come from. Pure helpers, so the
// wording lives in one place and is easy to test.

const PROVIDER_NAMES = {
  lrclib: 'LRCLIB',
  musixmatch: 'Musixmatch',
  kugou: 'KuGou Music',
  netease: 'NetEase Cloud Music',
  apple: 'Apple Music',
}

export const providerName = (id) => PROVIDER_NAMES[id] ?? id ?? ''

export const qualityLabel = (t, quality) => {
  switch (quality) {
    case 'karaoke':
      return t('ui.lyrics.quality.karaoke', 'Karaoke')
    case 'synced':
      return t('ui.lyrics.quality.synced', 'Synced')
    case 'plain':
      return t('ui.lyrics.quality.plain', 'Plain')
    default:
      return ''
  }
}

/** A short, human description of one lyrics source (`SourceInfo` from the API). */
export const sourceLabel = (t, info) => {
  if (!info) return ''
  switch (info.source) {
    case 'sidecar':
      return t('ui.lyrics.source.sidecar', 'Local file: %{file}', {
        file: info.file || '',
      })
    case 'embedded':
      return t('ui.lyrics.source.embedded', 'Embedded in the audio file')
    case 'managed':
      return t('ui.lyrics.source.managed', 'Downloaded from %{provider}', {
        provider: providerName(info.provider),
      })
    case 'user':
      return info.provider && info.provider !== 'import'
        ? t('ui.lyrics.source.userProvider', 'Chosen from %{provider}', {
            provider: providerName(info.provider),
          })
        : info.provider === 'import'
          ? t('ui.lyrics.source.imported', 'Imported file')
          : t('ui.lyrics.source.user', 'Chosen by you')
    case 'remote':
      return t('ui.lyrics.source.plugin', 'Plugin: %{name}', {
        name: info.provider || '',
      })
    default:
      return ''
  }
}

/** "+250 ms", "-100 ms", or "" for no offset. Positive shows lyrics sooner. */
export const formatOffset = (ms) =>
  !ms ? '' : `${ms > 0 ? '+' : '-'}${Math.abs(ms)} ms`

export const percent = (confidence) => `${Math.round((confidence || 0) * 100)}%`
