import React from 'react'
import {
  TopToolbar,
  ExportButton,
  sanitizeListRestProps,
  useListContext,
} from 'react-admin'
import DeleteMissingFilesButton from './DeleteMissingFilesButton.jsx'

// List props (filters, selection callbacks…) are not DOM attributes
const MissingListActions = ({ className, ...rest }) => {
  const { total } = useListContext()
  return (
    <TopToolbar className={className} {...sanitizeListRestProps(rest)}>
      <ExportButton maxResults={total} />
      <DeleteMissingFilesButton deleteAll />
    </TopToolbar>
  )
}

export default MissingListActions
