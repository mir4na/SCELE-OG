const lmsUrl = process.env.LMS_URL || 'http://localhost:3000'
const secret = process.env.BOT_SHARED_SECRET || 'bot-shared'
const intervalMs = Number(process.env.BOT_REVIEW_INTERVAL_MS || 7000)

let adminSid = ''

async function botFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${lmsUrl}${path}`
  const headers = {
    ...(options.headers || {}),
    'x-bot-secret': secret
  }
  if (adminSid) {
    headers.cookie = `sid=${adminSid}`
  }
  const response = await fetch(url, {
    ...options,
    headers
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { response, data }
}

async function browserFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${lmsUrl}${path}`
  const headers = {
    ...(options.headers || {}),
    cookie: `sid=${adminSid}`
  }
  const response = await fetch(url, {
    ...options,
    headers
  })
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    text: async () => text,
    json: async () => {
      if (!text) {
        return null
      }
      return JSON.parse(text)
    }
  }
}

function extractSnippets(html) {
  const snippets = []
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let scriptMatch = scriptRegex.exec(html)
  while (scriptMatch) {
    if (scriptMatch[1] && scriptMatch[1].trim()) {
      snippets.push(scriptMatch[1])
    }
    scriptMatch = scriptRegex.exec(html)
  }

  const onerrorRegex = /onerror\s*=\s*("([\s\S]*?)"|'([\s\S]*?)'|([^\s>]+))/gi
  let errorMatch = onerrorRegex.exec(html)
  while (errorMatch) {
    const code = errorMatch[2] || errorMatch[3] || errorMatch[4] || ''
    if (code.trim()) {
      snippets.push(code)
    }
    errorMatch = onerrorRegex.exec(html)
  }

  return snippets
}

async function executeSnippet(code) {
  const run = new Function(
    'fetch',
    'document',
    'window',
    'JSON',
    'Object',
    'Array',
    'String',
    'Number',
    'Promise',
    'setTimeout',
    'clearTimeout',
    `return (async () => { ${code}; await new Promise((resolve) => setTimeout(resolve, 500)); })()`
  )
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('snippet timeout')), 2500)
  })
  await Promise.race([
    run(
      browserFetch,
      { cookie: `sid=${adminSid}` },
      {},
      JSON,
      Object,
      Array,
      String,
      Number,
      Promise,
      setTimeout,
      clearTimeout
    ),
    timeout
  ])
}

async function reviewRenderedHtml(html) {
  const snippets = extractSnippets(html)
  for (const code of snippets) {
    try {
      await executeSnippet(code)
    } catch (error) {
      console.log(`snippet error: ${error.message}`)
    }
  }
}

async function bootstrapSession() {
  const { response, data } = await botFetch('/internal/bot/bootstrap')
  if (!response.ok || !data || !data.sid) {
    throw new Error('Failed to bootstrap bot session')
  }
  adminSid = data.sid
}

async function workCycle() {
  const { response, data } = await botFetch('/internal/bot/pending')
  if (!response.ok || !data) {
    return
  }
  if (!data.item) {
    return
  }
  await reviewRenderedHtml(data.item.rendered || '')
  await botFetch(`/internal/bot/reviewed/${data.item.id}`, { method: 'POST' })
}

async function run() {
  await bootstrapSession()
  console.log('grading-bot started')
  await workCycle()
  setInterval(() => {
    workCycle().catch((error) => {
      console.log(`cycle error: ${error.message}`)
    })
  }, intervalMs)
}

run().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
