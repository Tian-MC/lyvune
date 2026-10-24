import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playTopSongs, playShuffle } from './actions'
import subsonic from '../subsonic'

vi.mock('../subsonic', () => ({
  default: { getTopSongs: vi.fn() },
}))

const withReplayGain = {
  id: 'rec1',
  replayGain: { albumGain: -5, albumPeak: 1, trackGain: -6, trackPeak: 0.8 },
}

const respond = (body) =>
  subsonic.getTopSongs.mockResolvedValue({
    json: { 'subsonic-response': body },
  })

describe('artist actions', () => {
  const dispatch = vi.fn()
  const notify = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  describe('playTopSongs', () => {
    it('plays the top songs with their replaygain info', async () => {
      respond({ status: 'ok', topSongs: { song: [withReplayGain] } })
      await playTopSongs(dispatch, notify, 'Artist')
      expect(subsonic.getTopSongs).toHaveBeenCalledWith('Artist', 100)
      expect(dispatch.mock.calls[0][0].data.rec1).toMatchObject({
        rgAlbumGain: -5,
        rgAlbumPeak: 1,
        rgTrackGain: -6,
        rgTrackPeak: 0.8,
      })
    })

    it('rejects when the request fails', async () => {
      subsonic.getTopSongs.mockRejectedValue(new Error('Network error'))
      await expect(playTopSongs(dispatch, notify, 'Artist')).rejects.toThrow(
        'Network error',
      )
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('rejects on a failed API response', async () => {
      respond({
        status: 'failed',
        error: { code: 40, message: 'Wrong username or password' },
      })
      await expect(playTopSongs(dispatch, notify, 'Artist')).rejects.toThrow(
        'Wrong username or password',
      )
      expect(dispatch).not.toHaveBeenCalled()
    })

    it.each([
      ['an empty song list', { status: 'ok', topSongs: { song: [] } }],
      ['a missing topSongs property', { status: 'ok' }],
    ])('warns and plays nothing for %s', async (_, body) => {
      respond(body)
      await playTopSongs(dispatch, notify, 'Artist')
      expect(notify).toHaveBeenCalledWith('message.noTopSongsFound', 'warning')
      expect(dispatch).not.toHaveBeenCalled()
    })
  })

  describe('playShuffle', () => {
    it('queues a random selection of the artist songs', async () => {
      const getList = vi.fn().mockResolvedValue({ data: [{ id: 's1' }] })
      await playShuffle({ getList }, dispatch, 'ar1')
      expect(getList).toHaveBeenCalledWith('song', {
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'random', order: 'ASC' },
        filter: { album_artist_id: 'ar1', missing: false },
      })
      expect(dispatch).toHaveBeenCalled()
    })
  })
})
