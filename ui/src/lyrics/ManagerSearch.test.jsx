import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) =>
    String(opts?._ ?? key).replace(/%\{(\w+)\}/g, (_, k) => opts?.[k] ?? ''),
}))

import { ManagerSearch } from './ManagerSearch'

// FIXTURE data: synthetic candidates, not lyrics of any real recording
const cand = (id, provider, quality, extra = {}) => ({
  id,
  provider,
  quality,
  verified: true,
  storable: true,
  lines: 2,
  match: { confidence: 0.97 },
  meta: { title: 'Song', artist: 'Band' },
  ...extra,
})

const search = (candidates) => ({
  loading: false,
  done: true,
  providers: [],
  candidates,
})

const renderSearch = (candidates) =>
  render(
    <ManagerSearch
      search={search(candidates)}
      busy={false}
      onSearch={() => {}}
      onUse={() => {}}
    />,
  )

describe('ManagerSearch provider filter', () => {
  const all = [
    cand('kugou:1', 'kugou', 'karaoke', {
      wordTiming: true,
      translation: true,
    }),
    cand('netease:2', 'netease', 'synced', { romanization: true }),
    cand('lrclib:3', 'lrclib', 'plain'),
  ]

  it('lists every provider and shows all results by default', () => {
    renderSearch(all)
    const group = screen.getByRole('group', { name: 'Show results from' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All', 'KuGou Music', 'NetEase Cloud Music', 'LRCLIB'])
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
  })

  it('narrows the results to one provider and back', () => {
    renderSearch(all)
    fireEvent.click(screen.getByRole('button', { name: 'NetEase Cloud Music' }))
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('NetEase Cloud Music')
    expect(items[0].textContent).toContain('Romanization')
    expect(items[0].textContent).not.toContain('Word timing')
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('marks genuine word timing only on the candidate that has it', () => {
    renderSearch(all)
    fireEvent.click(screen.getByRole('button', { name: 'KuGou Music' }))
    expect(screen.getByText('Word timing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'LRCLIB' }))
    expect(screen.queryByText('Word timing')).toBeNull()
  })

  it('offers no filter when one provider answered', () => {
    renderSearch([cand('lrclib:3', 'lrclib', 'plain')])
    expect(
      screen.queryByRole('group', { name: 'Show results from' }),
    ).toBeNull()
  })
})

describe('ManagerSearch: what playing the track does with a result', () => {
  it('says why a word-timed version is not taken', () => {
    renderSearch([
      cand('kugou:1', 'kugou', 'karaoke', {
        wordTiming: true,
        auto: 'duration',
      }),
      cand('netease:2', 'netease', 'karaoke', {
        wordTiming: true,
        auto: 'provider-off',
      }),
    ])
    expect(
      screen.getByText(/its length differs from the track's by more than 5/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this provider is not turned on in the lyrics settings/),
    ).toBeInTheDocument()
  })

  it('marks the version that is taken, and says nothing about other line-timed ones', () => {
    renderSearch([
      cand('lrclib:1', 'lrclib', 'synced', { auto: 'chosen' }),
      cand('lrclib:2', 'lrclib', 'synced', { auto: 'not-better' }),
      cand('lrclib:3', 'lrclib', 'plain'),
    ])
    expect(
      screen.getAllByText('Chosen automatically when the track plays.'),
    ).toHaveLength(1)
    expect(screen.queryByText(/Not chosen automatically/)).toBeNull()
  })

  it('offers to search again once a search was made', () => {
    const onSearch = vi.fn()
    render(
      <ManagerSearch
        search={search([])}
        busy={false}
        onSearch={onSearch}
        onUse={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(onSearch).toHaveBeenCalledWith(true)
  })
})
