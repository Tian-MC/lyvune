// One-line summary of a playlist for cards and headers
export const playlistMeta = (t, pls) =>
  [
    pls.rules && t('ui.playlist.smart', 'Smart playlist'),
    t('ui.count.songs', '%{smart_count} songs', {
      smart_count: pls.songCount || 0,
    }),
    pls.ownerId !== localStorage.getItem('userId') && pls.ownerName,
  ]
    .filter(Boolean)
    .join(' · ')
