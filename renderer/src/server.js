import express from 'express'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'

const app = express()
const port = Number(process.env.PORT || 4000)

app.use(express.json({ limit: '1mb' }))

function renderMarkdown(markdown, sanitize, allowRawHtml) {
  const md = new MarkdownIt({
    html: allowRawHtml,
    linkify: true,
    breaks: true
  })
  const raw = md.render(markdown || '')
  if (!sanitize) {
    return raw
  }
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3']),
    allowedAttributes: {
      a: ['href', 'name', 'target'],
      img: ['src', 'alt', 'title']
    },
    allowedSchemes: ['http', 'https', 'mailto']
  })
}

app.post('/render', (req, res) => {
  const body = req.body || {}
  const markdown = typeof body.markdown === 'string' ? body.markdown : ''
  const options = body.options && typeof body.options === 'object' ? body.options : {}
  const sanitize = options.sanitize !== false
  const allowRawHtml = options.allowRawHtml === true
  const html = renderMarkdown(markdown, sanitize, allowRawHtml)
  res.json({ html })
})

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.listen(port, () => {
  console.log(`renderer listening on ${port}`)
})
