import { createCn } from 'cn/config'

/** Class merging that knows the theme's type tokens (text-label, text-title, ...) as font sizes, so a token is not
 * mistaken for a colour and dropped next to a component's own text-* size. */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['label', 'title', 'code', 'heading', 'display'] }] } },
})
