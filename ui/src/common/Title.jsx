import React from 'react'
import { useTranslate } from 'react-admin'

// Rendered by react-admin into the page heading of the application shell
export const Title = ({ subTitle, args }) => {
  const translate = useTranslate()
  const text = translate(subTitle, { ...args, _: subTitle })
  return <span>{text || 'Lyvune'}</span>
}
