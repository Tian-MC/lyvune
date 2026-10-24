// Record shape that makes Artwork/getCoverArtUrl resolve a queue item's art
// (media file art for songs, radio art for stations).
export const coverRecordFor = (item) =>
  item.isRadio
    ? { ...item.song, streamUrl: item.song?.streamUrl || '' }
    : { ...item.song, id: item.trackId, album: item.song?.album || ' ' }
