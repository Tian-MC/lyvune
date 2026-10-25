import httpClient from '../dataProvider/httpClient'
import { REST_URL } from '../consts'

const BASE = `${REST_URL}/lyrics`

const send = (method, path, body, options = {}) =>
  httpClient(`${BASE}${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...options,
  }).then((res) => res.json)

/** Client for the lyrics management API (/api/lyrics). */
export const lyricsApi = {
  settings: () => send('GET', '/settings'),
  saveSettings: (settings) => send('PUT', '/settings', settings),
  checkProviders: () => send('POST', '/providers/check', {}),
  status: (id, options) => send('GET', `/song/${id}`, undefined, options),
  resolve: (id, options) => send('POST', `/song/${id}/resolve`, {}, options),
  search: (id, body = {}) => send('POST', `/song/${id}/search`, body),
  apply: (id, body) => send('POST', `/song/${id}/apply`, body),
  importLyrics: (id, body) => send('POST', `/song/${id}/import`, body),
  lock: (id, locked) => send('PUT', `/song/${id}/lock`, { locked }),
  offset: (id, offsetMs) => send('PUT', `/song/${id}/offset`, { offsetMs }),
  restore: (id, version) => send('POST', `/song/${id}/restore`, { version }),
  remove: (id) => send('DELETE', `/song/${id}`),
  startBulk: (body) => send('POST', '/bulk', body),
  bulk: (id) => send('GET', `/bulk/${id}`),
  cancelBulk: (id) => send('DELETE', `/bulk/${id}`),
}

/** The machine-readable code of a failed lyrics request, if the server sent one. */
export const errorCode = (error) => error?.body?.error ?? null

/** The server's explanation of a failed lyrics request, if any. */
export const errorMessage = (error) => error?.body?.message ?? null

export default lyricsApi
