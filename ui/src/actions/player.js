export const PLAYER_ADD_TRACKS = 'PLAYER_ADD_TRACKS'
export const PLAYER_PLAY_NEXT = 'PLAYER_PLAY_NEXT'
export const PLAYER_SET_TRACK = 'PLAYER_SET_TRACK'
export const PLAYER_CLEAR_QUEUE = 'PLAYER_CLEAR_QUEUE'
export const PLAYER_PLAY_TRACKS = 'PLAYER_PLAY_TRACKS'
export const PLAYER_SET_VOLUME = 'PLAYER_SET_VOLUME'
export const TRANSCODING_SET_PROFILE = 'TRANSCODING_SET_PROFILE'
export const PLAYER_JUMP = 'PLAYER_JUMP'
export const PLAYER_NEXT = 'PLAYER_NEXT'
export const PLAYER_PREV = 'PLAYER_PREV'
export const PLAYER_ENDED = 'PLAYER_ENDED'
export const PLAYER_REMOVE = 'PLAYER_REMOVE'
export const PLAYER_MOVE = 'PLAYER_MOVE'
export const PLAYER_TOGGLE_SHUFFLE = 'PLAYER_TOGGLE_SHUFFLE'
export const PLAYER_SET_REPEAT = 'PLAYER_SET_REPEAT'

export const setTrack = (data) => ({
  type: PLAYER_SET_TRACK,
  data,
})

export const filterSongs = (data, ids) => {
  const filteredData = Object.fromEntries(
    Object.entries(data).filter(([_, song]) => !song.missing),
  )
  return !ids
    ? filteredData
    : ids.reduce((acc, id) => {
        if (filteredData[id]) {
          return { ...acc, [id]: filteredData[id] }
        }
        return acc
      }, {})
}

export const addTracks = (data, ids) => {
  const songs = filterSongs(data, ids)
  return {
    type: PLAYER_ADD_TRACKS,
    data: songs,
  }
}

export const playNext = (data, ids) => {
  const songs = filterSongs(data, ids)
  return {
    type: PLAYER_PLAY_NEXT,
    data: songs,
  }
}

export const shuffle = (data) => {
  const ids = Object.keys(data)
  for (let i = ids.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  const shuffled = {}
  // The "_" is to force the object key to be a string, so it keeps the order when adding to object
  // or else the keys will always be in the same (numerically) order
  ids.forEach((id) => (shuffled['_' + id] = data[id]))
  return shuffled
}

export const shuffleTracks = (data, ids) => {
  const songs = filterSongs(data, ids)
  const shuffled = shuffle(songs)
  const firstId = Object.keys(shuffled)[0]
  return {
    type: PLAYER_PLAY_TRACKS,
    id: firstId,
    data: shuffled,
  }
}

export const playTracks = (data, ids, selectedId) => {
  const songs = filterSongs(data, ids)
  return {
    type: PLAYER_PLAY_TRACKS,
    id: selectedId || Object.keys(songs)[0],
    data: songs,
  }
}

export const clearQueue = () => ({
  type: PLAYER_CLEAR_QUEUE,
})

export const setVolume = (volume) => ({
  type: PLAYER_SET_VOLUME,
  data: { volume },
})

export const setTranscodingProfile = (profile) => ({
  type: TRANSCODING_SET_PROFILE,
  data: profile,
})

// Queue navigation, dispatched by the playback engine and the player UI.
export const jumpTo = (index) => ({ type: PLAYER_JUMP, data: { index } })

export const nextTrack = () => ({ type: PLAYER_NEXT })

export const prevTrack = () => ({ type: PLAYER_PREV })

export const trackEnded = () => ({ type: PLAYER_ENDED })

export const removeFromQueue = (uuids) => ({
  type: PLAYER_REMOVE,
  data: { uuids: Array.isArray(uuids) ? uuids : [uuids] },
})

export const moveInQueue = (from, to) => ({
  type: PLAYER_MOVE,
  data: { from, to },
})

export const toggleShuffle = () => ({ type: PLAYER_TOGGLE_SHUFFLE })

export const setRepeat = (repeat) => ({
  type: PLAYER_SET_REPEAT,
  data: { repeat },
})
