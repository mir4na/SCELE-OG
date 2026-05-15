import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import dns from 'dns/promises'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mergePreferences } from './deepMerge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = Number(process.env.PORT || 3000)
const rendererUrl = process.env.RENDERER_URL || 'http://localhost:4000'
const botSharedSecret = process.env.BOT_SHARED_SECRET || 'bot-shared'
const gradeToken = process.env.GRADE_TOKEN || `GRADE-TOKEN-${createId(10)}`
const flagPath = path.join(__dirname, '..', 'flag.txt')
const flag = fs.existsSync(flagPath) ? fs.readFileSync(flagPath, 'utf8').trim() : 'CSCE604258{local_testing_flag}'

const users = {
  mahasiswa: { username: 'mahasiswa', password: 'tembokratapan123', role: 'student', displayName: 'Mahasiswa Tembokratapan' },
  asdos: { username: 'asdos', password: 'legacycompat', role: 'staff', displayName: 'Asisten Dosen' },
  graderbot: { username: 'graderbot', password: 'bot-internal-pass', role: 'admin', displayName: 'Grading Bot', internalOnly: true }
}

const sessions = new Map()
const discussions = []
const exfiltratedTokens = []
const legacyPlugins = [
  {
    id: 'markdown-legacy-html',
    name: 'Legacy Markdown HTML Compatibility',
    version: '0.9.7',
    signed: true,
    engine: 'legacy-markdown',
    code: 'eval(plugin.code)'
  }
]

let nextDiscussionId = 1
let nextExfilId = 1

function createId(size = 18) {
  return crypto.randomBytes(size).toString('hex')
}

function normalizeIp(value) {
  const ip = String(value || '')
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

let cachedBotIp = ''
let cachedBotIpAt = 0
const botIpTtlMs = 60_000

async function resolveBotIp() {
  const now = Date.now()
  if (cachedBotIp && now - cachedBotIpAt < botIpTtlMs) {
    return cachedBotIp
  }
  const { address } = await dns.lookup('bot')
  cachedBotIp = normalizeIp(address)
  cachedBotIpAt = now
  return cachedBotIp
}

function ensureSession(req, res) {
  let sid = req.cookies.sid
  if (!sid || !sessions.has(sid)) {
    sid = createId(16)
    const session = {
      sid,
      username: null,
      role: 'guest',
      importedPreferences: {},
      preferences: {},
      runtimeConfig: Object.create(null),
      activeLegacyPluginId: null,
      refreshedAt: null
    }
    sessions.set(sid, session)
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' })
  }
  return sessions.get(sid)
}

function requireAuth(req, res, next) {
  if (!req.session.username) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

function requireAdminSession(req, res, next) {
  if (!req.session.username || req.session.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}

function buildRuntimeConfig(session) {
  const defaults = Object.create(null)
  defaults.theme = 'scele-og'
  defaults.dashboard = 'course'
  defaults.compactView = false
  const merged = mergePreferences(defaults, session.importedPreferences || {})
  const runtimeConfig = {}
  runtimeConfig.courseId = 4163
  runtimeConfig.courseCode = 'TMBK-TK2-WEB'
  runtimeConfig.title = 'SCELE-OG Tembokratapan Learning Environment'
  runtimeConfig.theme = merged.theme || 'scele-og'
  runtimeConfig.compactView = merged.compactView === true
  if (Object.prototype.hasOwnProperty.call(merged, 'legacyMode') && merged.legacyMode === true) {
    runtimeConfig.legacyMode = true
  }
  session.preferences = merged
  session.runtimeConfig = runtimeConfig
  session.refreshedAt = Date.now()
  if (!runtimeConfig.legacyMode) {
    session.activeLegacyPluginId = null
  }
}

function publicUser(session) {
  return {
    username: session.username,
    role: session.role,
    displayName: session.username ? users[session.username].displayName : 'Guest',
    runtimeConfig: session.runtimeConfig,
    refreshedAt: session.refreshedAt
  }
}

function getRenderingOptionsForSession(session) {
  const options = {
    sanitize: true,
    allowRawHtml: false
  }
  const config = session.runtimeConfig || {}
  if (config.legacyMode === true && session.activeLegacyPluginId === 'markdown-legacy-html') {
    options.compatibility = true
  }
  if (options.compatibility === true) {
    options.allowRawHtml = true
    options.sanitize = false
  }
  return options
}

async function renderMarkdown(markdown, options) {
  const response = await fetch(`${rendererUrl}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ markdown, options })
  })
  if (!response.ok) {
    throw new Error('Renderer unavailable')
  }
  const data = await response.json()
  return data.html
}

function seedDiscussions() {
  discussions.push({
    id: nextDiscussionId++,
    title: 'Welcome to SCELE-OG',
    body: 'Gunakan forum ini untuk diskusi tugas dan kendala submission.',
    rendered: '<p>Gunakan forum ini untuk diskusi tugas dan kendala submission.</p>\n',
    author: 'asdos',
    createdAt: new Date().toISOString(),
    reviewedAt: null
  })
}

seedDiscussions()

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use((req, res, next) => {
  req.session = ensureSession(req, res)
  next()
})

app.get('/api/bootstrap', (req, res) => {
  res.json({
    app: {
      name: 'SCELE-OG',
      university: 'Tembokratapan University',
      coursePath: '/course/view.php?id=4163'
    },
    me: publicUser(req.session),
    featureProbe: {
      bundleFunctions: ['legacyPluginLoader', 'courseTopicHydration', 'gradeWidgetMount']
    }
  })
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }
  const user = users[username]
  if (!user || user.internalOnly === true || user.password !== password) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }
  const sid = createId(16)
  const session = {
    sid,
    username: user.username,
    role: user.role,
    importedPreferences: {},
    preferences: {},
    runtimeConfig: Object.create(null),
    activeLegacyPluginId: null,
    refreshedAt: null
  }
  buildRuntimeConfig(session)
  sessions.set(sid, session)
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' })
  res.json({ ok: true, user: publicUser(session) })
})

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.session.sid)
  res.clearCookie('sid')
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({ me: publicUser(req.session) })
})

app.post('/api/user/preferences/import', requireAuth, (req, res) => {
  const incoming = req.body
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    res.status(400).json({ error: 'Invalid preferences payload' })
    return
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'legacyMode')) {
    res.status(400).json({ error: 'legacyMode is managed by system policy' })
    return
  }
  req.session.importedPreferences = mergePreferences(req.session.importedPreferences || {}, incoming)
  if (Object.prototype.hasOwnProperty.call(Object.prototype, 'legacyMode')) {
    req.session.importedPreferences.legacyMode = Object.prototype.legacyMode === true
    delete Object.prototype.legacyMode
  }
  res.json({
    ok: true,
    message: 'Preferences imported. Session refresh required to apply.',
    pendingKeys: Object.keys(incoming)
  })
})

app.post('/api/session/refresh', requireAuth, (req, res) => {
  buildRuntimeConfig(req.session)
  res.json({
    ok: true,
    refreshed: true,
    runtimeConfig: req.session.runtimeConfig
  })
})

app.get('/api/plugins/legacy', requireAuth, (req, res) => {
  if (req.session.runtimeConfig.legacyMode !== true) {
    res.status(404).json({ error: 'Feature not found' })
    return
  }
  const available = legacyPlugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    signed: plugin.signed,
    engine: plugin.engine
  }))
  res.json({
    ok: true,
    legacyMode: true,
    plugins: available,
    compatibilityBanner: 'Legacy Plugin Compatibility Mode Enabled'
  })
})

app.post('/api/plugins/legacy/activate', requireAuth, (req, res) => {
  if (req.session.runtimeConfig.legacyMode !== true) {
    res.status(404).json({ error: 'Feature not found' })
    return
  }
  const { pluginId } = req.body || {}
  const plugin = legacyPlugins.find((item) => item.id === pluginId)
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not found' })
    return
  }
  req.session.activeLegacyPluginId = plugin.id
  res.json({ ok: true, activePlugin: plugin.id })
})

app.get('/api/discussions', requireAuth, (req, res) => {
  const list = discussions
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      rendered: item.rendered,
      author: item.author,
      createdAt: item.createdAt
    }))
  res.json({ discussions: list })
})

app.post('/api/discussions', requireAuth, async (req, res) => {
  const { title, body } = req.body || {}
  if (typeof title !== 'string' || typeof body !== 'string') {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }
  if (!title.trim() || !body.trim()) {
    res.status(400).json({ error: 'Title and body are required' })
    return
  }
  if (title.length > 120 || body.length > 6000) {
    res.status(400).json({ error: 'Content too long' })
    return
  }
  try {
    const options = getRenderingOptionsForSession(req.session)
    const rendered = await renderMarkdown(body, options)
    const discussion = {
      id: nextDiscussionId++,
      title,
      body,
      rendered,
      author: req.session.username,
      createdAt: new Date().toISOString(),
      reviewedAt: null
    }
    discussions.push(discussion)
    res.status(201).json({ ok: true, discussion })
  } catch (error) {
    res.status(502).json({ error: 'Renderer unavailable' })
  }
})

app.post('/api/exfil', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const note = typeof req.body?.note === 'string' ? req.body.note : ''
  if (!token) {
    res.status(400).json({ error: 'Token required' })
    return
  }
  exfiltratedTokens.push({
    id: nextExfilId++,
    token,
    note,
    sourceUser: req.session.username,
    createdAt: new Date().toISOString()
  })
  res.json({ ok: true })
})

app.get('/api/exfil', requireAuth, (req, res) => {
  res.json({
    leaks: exfiltratedTokens.slice().reverse()
  })
})

app.get('/internal/grade/token', requireAdminSession, (req, res) => {
  res.json({ token: gradeToken, issuedAt: new Date().toISOString() })
})

app.get('/internal/audit/export', (req, res) => {
  const provided = req.get('x-grade-token') || ''
  if (provided !== gradeToken) {
    res.status(403).json({ error: 'Invalid grade token' })
    return
  }
  res.json({
    ok: true,
    export: {
      university: 'Tembokratapan University',
      system: 'SCELE-OG',
      flag
    }
  })
})

async function requireBot(req, res, next) {
  const remoteIp = normalizeIp(req.socket?.remoteAddress)
  const hasValidSecret = req.get('x-bot-secret') === botSharedSecret
  let isTrustedSource = true
  try {
    const trustedBotIp = await resolveBotIp()
    isTrustedSource = remoteIp === trustedBotIp
  } catch {
    isTrustedSource = true
  }
  if (!hasValidSecret || !isTrustedSource) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}

app.get('/internal/bot/bootstrap', requireBot, (req, res) => {
  let adminSession = Array.from(sessions.values()).find((s) => s.username === 'graderbot' && s.role === 'admin')
  if (!adminSession) {
    const sid = createId(16)
    adminSession = {
      sid,
      username: 'graderbot',
      role: 'admin',
      importedPreferences: {},
      preferences: {},
      runtimeConfig: Object.create(null),
      activeLegacyPluginId: null,
      refreshedAt: null
    }
    buildRuntimeConfig(adminSession)
    sessions.set(sid, adminSession)
  }
  res.json({ sid: adminSession.sid })
})

app.get('/internal/bot/pending', requireBot, (req, res) => {
  const item = discussions.find((discussion) => discussion.reviewedAt === null)
  if (!item) {
    res.json({ item: null })
    return
  }
  res.json({
    item: {
      id: item.id,
      title: item.title,
      rendered: item.rendered
    }
  })
})

app.post('/internal/bot/reviewed/:id', requireBot, (req, res) => {
  const id = Number(req.params.id)
  const item = discussions.find((discussion) => discussion.id === id)
  if (!item) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  item.reviewedAt = new Date().toISOString()
  res.json({ ok: true })
})

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

app.listen(port, () => {
  console.log(`lms listening on ${port}`)
})
