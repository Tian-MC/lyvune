import React from 'react'
import clsx from 'clsx'
import Linkify from '../../common/Linkify'
import styles from './Comment.module.css'

/** Free-text comment: line breaks kept, web addresses are clickable. */
export const Comment = ({ text, className }) => {
  if (!text) return null
  return (
    <p className={clsx(styles.comment, className)}>
      {text.split('\n').map((line, i, lines) => (
        <React.Fragment key={i}>
          <Linkify text={line} />
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  )
}

export default Comment
