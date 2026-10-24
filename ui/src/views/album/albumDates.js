import { formatRange } from '../../common/formatRange'
import { formatFullDate } from '../../utils/formatters'

/**
 * Date lines shown in the album header, in display order:
 * - the original date (labelled) when it differs from the release's own date,
 *   otherwise the date, otherwise the year range;
 * - the release date (labelled), unless it is the line already shown.
 */
export const albumDateParts = (record, { locale, labels }) => {
  if (!record) return []
  const yearRange = formatRange(record, 'year')
  const date = record.date ? formatFullDate(record.date, locale) : yearRange
  const originalDate = record.originalDate
    ? formatFullDate(record.originalDate, locale)
    : formatRange(record, 'originalYear')
  const releaseDate = record.releaseDate
    ? formatFullDate(record.releaseDate, locale)
    : ''
  const main = originalDate || date
  const isOriginal = !!originalDate && main !== date
  const parts = []
  if (main && main !== releaseDate) {
    parts.push(isOriginal ? `${labels.original} ${main}` : main)
  }
  if (releaseDate) {
    parts.push(`${labels.released} ${releaseDate}`)
  }
  return parts
}
