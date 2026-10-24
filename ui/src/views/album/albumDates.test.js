import { describe, it, expect } from 'vitest'
import { albumDateParts } from './albumDates'

// en-CA keeps month names deterministic across environments
const opts = {
  locale: 'en-CA',
  labels: { original: 'Original', released: 'Released' },
}
const base = { id: '1', name: 'Test Album', songCount: 12 }

describe('albumDateParts', () => {
  it('shows the year when there is no full date', () => {
    expect(albumDateParts({ ...base, year: 2020 }, opts)).toEqual([])
    expect(
      albumDateParts({ ...base, minYear: 2020, maxYear: 2020 }, opts),
    ).toEqual(['2020'])
  })

  it('shows a year range', () => {
    expect(
      albumDateParts({ ...base, minYear: 2018, maxYear: 2020 }, opts),
    ).toEqual(['2018-2020'])
  })

  it('shows the date without a label', () => {
    expect(albumDateParts({ ...base, date: '2020-05-01' }, opts)).toEqual([
      'May 1, 2020',
    ])
  })

  it('labels the original date when there is no other date', () => {
    expect(
      albumDateParts({ ...base, originalDate: '2018-03-15' }, opts),
    ).toEqual(['Original Mar 15, 2018'])
  })

  it('prefers the original date over the date', () => {
    expect(
      albumDateParts(
        { ...base, date: '2020-05-01', originalDate: '2018-03-15' },
        opts,
      ),
    ).toEqual(['Original Mar 15, 2018'])
  })

  it('does not label an original date equal to the date', () => {
    expect(
      albumDateParts(
        { ...base, date: '2020-05-01', originalDate: '2020-05-01' },
        opts,
      ),
    ).toEqual(['May 1, 2020'])
  })

  it('labels the release date', () => {
    expect(
      albumDateParts({ ...base, releaseDate: '2020-06-15' }, opts),
    ).toEqual(['Released Jun 15, 2020'])
  })

  it('shows original and release dates together', () => {
    expect(
      albumDateParts(
        {
          ...base,
          date: '2020-05-01',
          originalDate: '2018-03-15',
          releaseDate: '2020-06-15',
        },
        opts,
      ),
    ).toEqual(['Original Mar 15, 2018', 'Released Jun 15, 2020'])
  })

  it('hides the main date when it equals the release date', () => {
    expect(
      albumDateParts(
        { ...base, date: '2020-06-15', releaseDate: '2020-06-15' },
        opts,
      ),
    ).toEqual(['Released Jun 15, 2020'])
  })

  it('uses the original year range', () => {
    expect(
      albumDateParts(
        { ...base, minOriginalYear: 1999, maxOriginalYear: 2001 },
        opts,
      ),
    ).toEqual(['Original 1999-2001'])
  })

  it('returns nothing for a missing record or no date fields', () => {
    expect(albumDateParts(undefined, opts)).toEqual([])
    expect(albumDateParts(base, opts)).toEqual([])
  })
})
