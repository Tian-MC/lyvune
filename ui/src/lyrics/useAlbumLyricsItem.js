import { useCallback } from 'react'
import { useNotify } from 'react-admin'
import { useT } from '../i18n/useT'
import { LyricsIcon } from '../design/icons'
import { errorCode, lyricsApi } from './manageApi'

/**
 * A menu item for administrators that looks for the missing lyrics of one
 * album, as a background job. Returns `false` for everyone else, so it can be
 * placed in a menu without a condition.
 */
export const useAlbumLyricsItem = (albumId) => {
  const t = useT()
  const notify = useNotify()
  const run = useCallback(async () => {
    try {
      const job = await lyricsApi.startBulk({
        action: 'missing',
        albumIds: [albumId],
      })
      notify(
        t(
          'ui.lyrics.bulk.albumStarted',
          'Looking for lyrics for %{count} tracks in the background.',
          { count: job.total },
        ),
        'info',
      )
    } catch (e) {
      notify(
        errorCode(e) === 'busy'
          ? t('ui.lyrics.bulk.busy', 'Another bulk job is already running.')
          : t('ui.lyrics.bulk.failed', 'The job could not be started.'),
        'warning',
      )
    }
  }, [albumId, notify, t])

  if (localStorage.getItem('role') !== 'admin') return false
  return {
    key: 'lyrics',
    icon: LyricsIcon,
    label: t('ui.lyrics.bulk.album', 'Find lyrics for this album'),
    onSelect: run,
  }
}

export default useAlbumLyricsItem
