import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpClient = vi.hoisted(() => vi.fn())
vi.mock('../dataProvider/httpClient', () => ({ default: httpClient }))

import { errorCode, errorMessage, lyricsApi } from './manageApi'

describe('lyricsApi', () => {
  beforeEach(() => {
    httpClient.mockReset()
    httpClient.mockResolvedValue({ json: { ok: true } })
  })

  const lastCall = () => {
    const [url, options] = httpClient.mock.calls.at(-1)
    return {
      url,
      method: options.method,
      body: options.body && JSON.parse(options.body),
      options,
    }
  }

  it('returns the parsed body', async () => {
    httpClient.mockResolvedValue({ json: { current: null } })
    expect(await lyricsApi.status('t1')).toEqual({ current: null })
  })

  it.each([
    [
      'settings',
      () => lyricsApi.settings(),
      'GET',
      '/api/lyrics/settings',
      undefined,
    ],
    [
      'saveSettings',
      () => lyricsApi.saveSettings({ a: 1 }),
      'PUT',
      '/api/lyrics/settings',
      { a: 1 },
    ],
    [
      'status',
      () => lyricsApi.status('t1'),
      'GET',
      '/api/lyrics/song/t1',
      undefined,
    ],
    [
      'resolve',
      () => lyricsApi.resolve('t1'),
      'POST',
      '/api/lyrics/song/t1/resolve',
      {},
    ],
    [
      'search',
      () => lyricsApi.search('t1', { showAll: true }),
      'POST',
      '/api/lyrics/song/t1/search',
      { showAll: true },
    ],
    [
      'apply',
      () => lyricsApi.apply('t1', { candidateId: 'x' }),
      'POST',
      '/api/lyrics/song/t1/apply',
      { candidateId: 'x' },
    ],
    [
      'import',
      () => lyricsApi.importLyrics('t1', { fileName: 'a.lrc' }),
      'POST',
      '/api/lyrics/song/t1/import',
      { fileName: 'a.lrc' },
    ],
    [
      'lock',
      () => lyricsApi.lock('t1', true),
      'PUT',
      '/api/lyrics/song/t1/lock',
      { locked: true },
    ],
    [
      'offset',
      () => lyricsApi.offset('t1', -200),
      'PUT',
      '/api/lyrics/song/t1/offset',
      { offsetMs: -200 },
    ],
    [
      'restore',
      () => lyricsApi.restore('t1', 'v1'),
      'POST',
      '/api/lyrics/song/t1/restore',
      { version: 'v1' },
    ],
    [
      'remove',
      () => lyricsApi.remove('t1'),
      'DELETE',
      '/api/lyrics/song/t1',
      undefined,
    ],
    [
      'startBulk',
      () => lyricsApi.startBulk({ action: 'missing', all: true }),
      'POST',
      '/api/lyrics/bulk',
      { action: 'missing', all: true },
    ],
    [
      'bulk',
      () => lyricsApi.bulk('b1'),
      'GET',
      '/api/lyrics/bulk/b1',
      undefined,
    ],
    [
      'cancelBulk',
      () => lyricsApi.cancelBulk('b1'),
      'DELETE',
      '/api/lyrics/bulk/b1',
      undefined,
    ],
  ])('%s calls the right endpoint', async (_name, call, method, url, body) => {
    await call()
    const sent = lastCall()
    expect(sent.method).toBe(method)
    expect(sent.url).toBe(url)
    expect(sent.body).toEqual(body)
  })

  it('passes an abort signal through', async () => {
    const controller = new AbortController()
    await lyricsApi.status('t1', { signal: controller.signal })
    expect(lastCall().options.signal).toBe(controller.signal)
  })

  it('reads the error code and message the server sent', () => {
    const error = {
      status: 409,
      body: { error: 'locked', message: 'These lyrics are locked.' },
    }
    expect(errorCode(error)).toBe('locked')
    expect(errorMessage(error)).toBe('These lyrics are locked.')
  })

  it('has no code for errors without a body', () => {
    expect(errorCode(new Error('network'))).toBeNull()
    expect(errorCode(undefined)).toBeNull()
    expect(errorMessage({ status: 403 })).toBeNull()
  })
})
