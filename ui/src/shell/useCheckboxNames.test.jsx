import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useCheckboxNames } from './useCheckboxNames'

// The markup Material-UI renders for react-admin's selection checkboxes
const Box = ({ label }) => (
  <span className="MuiCheckbox-root" aria-label={label}>
    <span className="MuiIconButton-label">
      <input type="checkbox" />
    </span>
  </span>
)

const Table = () => (
  <table>
    <thead>
      <tr>
        <th>
          <Box label="Select all" />
        </th>
        <th>Name</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <Box label="Select this row" />
        </td>
        <td>Library One</td>
      </tr>
    </tbody>
  </table>
)

const Host = ({ children }) => {
  useCheckboxNames()
  return children
}

describe('useCheckboxNames', () => {
  it('names the select-all and row checkboxes, with the row for context', () => {
    const { container } = render(
      <Host>
        <Table />
      </Host>,
    )
    const [all, row] = container.querySelectorAll('input')
    expect(all.getAttribute('aria-label')).toBe('Select all')
    expect(row.getAttribute('aria-label')).toBe('Select this row: Library One')
  })

  it('names checkboxes added later, such as a new page of rows', async () => {
    const { container, rerender } = render(<Host>{null}</Host>)
    rerender(
      <Host>
        <Table />
      </Host>,
    )
    await waitFor(() =>
      expect(container.querySelectorAll('input[aria-label]').length).toBe(2),
    )
  })

  it('leaves checkboxes that already have a name alone', () => {
    const { container } = render(
      <Host>
        <label>
          Mine <input type="checkbox" />
        </label>
        <span aria-label="Wrapper">
          <span>
            <input type="checkbox" aria-label="Own" />
          </span>
        </span>
      </Host>,
    )
    const [labelled, own] = container.querySelectorAll('input')
    expect(labelled.hasAttribute('aria-label')).toBe(false)
    expect(own.getAttribute('aria-label')).toBe('Own')
  })

  it('does nothing for a checkbox with no wrapper label to borrow', () => {
    const { container } = render(
      <Host>
        <input type="checkbox" />
      </Host>,
    )
    expect(container.querySelector('input').hasAttribute('aria-label')).toBe(
      false,
    )
  })
})
