// Title as shown in the player: the song title plus its `subtitle` tag
export const trackTitle = (song, fallback = '') => {
  const title = song?.title || fallback
  const subtitle = song?.tags?.subtitle
  const text = Array.isArray(subtitle) ? subtitle[0] : subtitle
  return text ? `${title} (${text})` : title
}
