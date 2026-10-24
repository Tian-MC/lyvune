import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearResumePoint,
  readResumePoint,
  saveResumePoint,
} from './resumePoint'

describe('resume point', () => {
  beforeEach(() => localStorage.clear())

  it('returns where the same track was left', () => {
    saveResumePoint('a', 42.5)
    expect(readResumePoint('a', 200)).toBe(42.5)
  })

  it('ignores a point saved for another track', () => {
    saveResumePoint('a', 42.5)
    expect(readResumePoint('b', 200)).toBe(0)
  })

  it('starts a finished track over, not a second before its end', () => {
    saveResumePoint('a', 540.4)
    expect(readResumePoint('a', 540.4)).toBe(0)
    saveResumePoint('a', 538)
    expect(readResumePoint('a', 540.4)).toBe(0)
  })

  it('still resumes shortly before the end margin', () => {
    saveResumePoint('a', 530)
    expect(readResumePoint('a', 540.4)).toBe(530)
  })

  it('resumes when the duration is not known yet', () => {
    saveResumePoint('a', 30)
    expect(readResumePoint('a', 0)).toBe(30)
    expect(readResumePoint('a', undefined)).toBe(30)
  })

  it('forgets the point once cleared', () => {
    saveResumePoint('a', 30)
    clearResumePoint()
    expect(readResumePoint('a', 200)).toBe(0)
  })

  it('treats corrupt or missing storage as the start', () => {
    expect(readResumePoint('a', 200)).toBe(0)
    localStorage.setItem('nd-playback-position', '{not json')
    expect(readResumePoint('a', 200)).toBe(0)
  })
})
