import { v4 as uuidv4 } from 'uuid'
import subsonic from '../subsonic'
import {
  PLAYER_ADD_TRACKS,
  PLAYER_CLEAR_QUEUE,
  PLAYER_PLAY_NEXT,
  PLAYER_PLAY_TRACKS,
  PLAYER_SET_TRACK,
  PLAYER_SET_VOLUME,
  PLAYER_JUMP,
  PLAYER_NEXT,
  PLAYER_PREV,
  PLAYER_ENDED,
  PLAYER_REMOVE,
  PLAYER_MOVE,
  PLAYER_TOGGLE_SHUFFLE,
  PLAYER_SET_REPEAT,
} from '../actions'
import config from '../config'

// The player slice describes playback *intent*: what is queued, which item is
// current, and how the queue advances. The audio itself lives in the playback
// engine (playback/engine.js), which follows this state. `playRequest` is a
// counter the engine watches to know the user asked for audio to start.
//
// `savedPlayIndex` is the persisted name of the current index (kept for
// compatibility with queues saved by previous versions).
export const REPEAT_OFF = 'off'
export const REPEAT_ALL = 'all'
export const REPEAT_ONE = 'one'

const initialState = {
  queue: [],
  savedPlayIndex: 0,
  volume: config.defaultUIVolume / 100,
  shuffle: false,
  originalOrder: null,
  repeat: REPEAT_OFF,
  playRequest: 0,
}

export const mapToAudioLists = (item) => {
  // If item comes from a playlist, trackId is mediaFileId
  const trackId = item.mediaFileId || item.id

  if (item.isRadio) {
    return {
      trackId,
      uuid: uuidv4(),
      name: item.name,
      song: item,
      musicSrc: item.streamUrl,
      cover: item.cover,
      isRadio: true,
    }
  }

  return {
    trackId,
    uuid: uuidv4(),
    song: item,
    name: item.title,
    singer: item.artist,
    duration: item.duration,
    cover: subsonic.getCoverArtUrl(
      {
        id: trackId,
        updatedAt: item.updatedAt,
        album: item.album,
      },
      300,
    ),
  }
}

const clampIndex = (index, queue) =>
  queue.length === 0 ? 0 : Math.min(Math.max(index, 0), queue.length - 1)

const requestPlay = (state) => ({
  ...state,
  playRequest: (state.playRequest || 0) + 1,
})

const shuffleArray = (array) => {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

const withNewQueue = (state, queue, index) =>
  requestPlay({
    ...state,
    queue,
    savedPlayIndex: clampIndex(index, queue),
    // A freshly loaded queue defines a new "original" order
    originalOrder: state.shuffle ? queue.map((i) => i.uuid) : null,
  })

const reducePlayTracks = (state, { data, id }) => {
  let playIndex = 0
  const queue = Object.keys(data).map((key, idx) => {
    if (key === id) {
      playIndex = idx
    }
    return mapToAudioLists(data[key])
  })
  return withNewQueue(state, queue, playIndex)
}

const reduceSetTrack = (state, { data }) =>
  withNewQueue(state, [mapToAudioLists(data)], 0)

const appendToOriginal = (state, items) =>
  state.originalOrder
    ? [...state.originalOrder, ...items.map((i) => i.uuid)]
    : state.originalOrder

const reduceAddTracks = (state, { data }) => {
  const items = Object.keys(data).map((id) => mapToAudioLists(data[id]))
  const next = {
    ...state,
    queue: [...state.queue, ...items],
    originalOrder: appendToOriginal(state, items),
  }
  return state.queue.length === 0 && items.length > 0
    ? requestPlay({ ...next, savedPlayIndex: 0 })
    : next
}

const reducePlayNext = (state, { data }) => {
  const items = Object.keys(data).map((id) => mapToAudioLists(data[id]))
  if (state.queue.length === 0) {
    return requestPlay({ ...state, queue: items, savedPlayIndex: 0 })
  }
  const at = clampIndex(state.savedPlayIndex, state.queue) + 1
  const queue = [
    ...state.queue.slice(0, at),
    ...items,
    ...state.queue.slice(at),
  ]
  return { ...state, queue, originalOrder: appendToOriginal(state, items) }
}

const reduceJump = (state, { data: { index } }) => {
  if (index < 0 || index >= state.queue.length) return state
  return requestPlay({ ...state, savedPlayIndex: index })
}

const reduceNext = (state) => {
  const { queue, savedPlayIndex } = state
  if (queue.length === 0) return state
  if (savedPlayIndex < queue.length - 1) {
    return requestPlay({ ...state, savedPlayIndex: savedPlayIndex + 1 })
  }
  if (state.repeat === REPEAT_ALL) {
    return requestPlay({ ...state, savedPlayIndex: 0 })
  }
  return state
}

const reducePrev = (state) => {
  const { queue, savedPlayIndex } = state
  if (queue.length === 0) return state
  if (savedPlayIndex > 0) {
    return requestPlay({ ...state, savedPlayIndex: savedPlayIndex - 1 })
  }
  if (state.repeat === REPEAT_ALL) {
    return requestPlay({ ...state, savedPlayIndex: queue.length - 1 })
  }
  // At the head of the queue "previous" restarts the first track
  return requestPlay(state)
}

const reduceEnded = (state) => {
  if (state.repeat === REPEAT_ONE) {
    return requestPlay(state)
  }
  return reduceNext(state)
}

const reduceRemove = (state, { data: { uuids } }) => {
  const remove = new Set(uuids)
  const current = state.queue[state.savedPlayIndex]
  const before = state.queue
    .slice(0, state.savedPlayIndex)
    .filter((i) => remove.has(i.uuid)).length
  const queue = state.queue.filter((i) => !remove.has(i.uuid))
  if (queue.length === 0) {
    return reduceClearQueue(state)
  }
  let index = state.savedPlayIndex - before
  if (current && !remove.has(current.uuid)) {
    index = queue.findIndex((i) => i.uuid === current.uuid)
  }
  return {
    ...state,
    queue,
    savedPlayIndex: clampIndex(index, queue),
    originalOrder: state.originalOrder
      ? state.originalOrder.filter((u) => !remove.has(u))
      : null,
  }
}

const reduceMove = (state, { data: { from, to } }) => {
  const { queue } = state
  if (from === to || from < 0 || to < 0 || from >= queue.length) return state
  const current = queue[state.savedPlayIndex]
  const next = [...queue]
  const [moved] = next.splice(from, 1)
  next.splice(Math.min(to, next.length), 0, moved)
  return {
    ...state,
    queue: next,
    savedPlayIndex: current
      ? next.findIndex((i) => i.uuid === current.uuid)
      : state.savedPlayIndex,
  }
}

const reduceToggleShuffle = (state) => {
  const { queue, savedPlayIndex } = state
  const current = queue[savedPlayIndex]
  if (!state.shuffle) {
    // Keep what was already played (and the current track) in place,
    // shuffle what is up next.
    const head = queue.slice(0, savedPlayIndex + 1)
    const tail = shuffleArray(queue.slice(savedPlayIndex + 1))
    return {
      ...state,
      shuffle: true,
      originalOrder: queue.map((i) => i.uuid),
      queue: [...head, ...tail],
    }
  }
  const order = new Map((state.originalOrder || []).map((u, i) => [u, i]))
  const restored = [...queue].sort((a, b) => {
    const ia = order.has(a.uuid) ? order.get(a.uuid) : Infinity
    const ib = order.has(b.uuid) ? order.get(b.uuid) : Infinity
    return ia - ib
  })
  return {
    ...state,
    shuffle: false,
    originalOrder: null,
    queue: restored,
    savedPlayIndex: current
      ? restored.findIndex((i) => i.uuid === current.uuid)
      : 0,
  }
}

const reduceClearQueue = (state = initialState) => ({
  ...initialState,
  volume: state.volume ?? initialState.volume,
  shuffle: state.shuffle ?? false,
  repeat: state.repeat ?? REPEAT_OFF,
  playRequest: state.playRequest || 0,
})

export const playerReducer = (previousState = initialState, payload) => {
  const { type } = payload
  switch (type) {
    case PLAYER_CLEAR_QUEUE:
      return reduceClearQueue(previousState)
    case PLAYER_PLAY_TRACKS:
      return reducePlayTracks(previousState, payload)
    case PLAYER_SET_TRACK:
      return reduceSetTrack(previousState, payload)
    case PLAYER_ADD_TRACKS:
      return reduceAddTracks(previousState, payload)
    case PLAYER_PLAY_NEXT:
      return reducePlayNext(previousState, payload)
    case PLAYER_SET_VOLUME:
      return { ...previousState, volume: payload.data.volume }
    case PLAYER_JUMP:
      return reduceJump(previousState, payload)
    case PLAYER_NEXT:
      return reduceNext(previousState)
    case PLAYER_PREV:
      return reducePrev(previousState)
    case PLAYER_ENDED:
      return reduceEnded(previousState)
    case PLAYER_REMOVE:
      return reduceRemove(previousState, payload)
    case PLAYER_MOVE:
      return reduceMove(previousState, payload)
    case PLAYER_TOGGLE_SHUFFLE:
      return reduceToggleShuffle(previousState)
    case PLAYER_SET_REPEAT:
      return { ...previousState, repeat: payload.data.repeat }
    default:
      return previousState
  }
}

// Selectors
export const selectCurrentItem = (state) =>
  state.player.queue[state.player.savedPlayIndex] || null
