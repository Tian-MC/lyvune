import React from 'react'
import { useSelector } from 'react-redux'
import { QualityInfo } from '../common/QualityInfo'
import { decisionService } from '../transcode'

/**
 * Format, bitrate and ReplayGain of the current track, and whether it is
 * played directly or transcoded (same information the previous player showed).
 */
export const TrackQuality = ({ item, song, className }) => {
  const gainInfo = useSelector((state) => state.replayGain)
  if (!item || item.isRadio || !song) return null

  const decision = decisionService.getCachedDecision(item.trackId)
  const transcodeProps = decision
    ? {
        transcodeStream: decision.transcodeStream || null,
        isDirectPlay: decision.canDirectPlay,
      }
    : {}

  return (
    <QualityInfo
      record={{
        suffix: song.suffix,
        bitRate: song.bitRate,
        rgAlbumGain: song.rgAlbumGain,
        rgAlbumPeak: song.rgAlbumPeak,
        rgTrackGain: song.rgTrackGain,
        rgTrackPeak: song.rgTrackPeak,
      }}
      className={className}
      {...gainInfo}
      {...transcodeProps}
    />
  )
}

export default TrackQuality
