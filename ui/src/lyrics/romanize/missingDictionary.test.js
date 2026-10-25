import { describe, it, expect, vi } from 'vitest'

// A server that does not have the dictionary: the load fails
vi.mock('kuromoji/build/kuromoji.js', () => ({
  default: {
    builder: () => ({ build: (done) => done(new Error('404')) }),
  },
}))

import { romanizeLines } from '.'

describe('without the Japanese dictionary', () => {
  it('still reads kana, which needs no dictionary', async () => {
    const out = await romanizeLines(['ありがとう', 'ハード'], ['ja'])
    expect(out).toEqual(['arigatou', 'haado'])
  })

  it('leaves out the lines with kanji instead of guessing them', async () => {
    const out = await romanizeLines(['ありがとう', '君を探した'], ['ja'])
    expect(out).toEqual(['arigatou', null])
  })

  it('says so when nothing could be romanized', async () => {
    await expect(
      romanizeLines(['君を探した', '東京'], ['ja']),
    ).rejects.toThrow()
  })

  it('does not keep asking for a dictionary that is not there', async () => {
    const fetches = vi.fn()
    const first = romanizeLines(['東京'], ['ja']).catch(fetches)
    await first
    const t0 = Date.now()
    await romanizeLines(['京都'], ['ja']).catch(fetches)
    expect(Date.now() - t0).toBeLessThan(50)
    expect(fetches).toHaveBeenCalledTimes(2)
  })
})
