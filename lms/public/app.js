const state = {
  me: null
}

function legacyPluginLoader() {
  return true
}

function courseTopicHydration() {
  return true
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const message = data && data.error ? data.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return data
}

function renderMe() {
  const userStatus = document.getElementById('userStatus')
  if (!userStatus) {
    return
  }
  if (state.me && state.me.username) {
    userStatus.textContent = `${state.me.displayName} (${state.me.role})`
  } else {
    userStatus.textContent = 'You are not logged in.'
  }
}

function renderDiscussions(items) {
  const box = document.getElementById('discussionList')
  if (!box) {
    return
  }
  box.innerHTML = ''
  for (const item of items) {
    const div = document.createElement('div')
    div.className = 'discussion-item'
    div.innerHTML = `
      <h4>${item.title}</h4>
      <div class="discussion-meta">#${item.id} by ${item.author} at ${item.createdAt}</div>
      <div class="discussion-render">${item.rendered}</div>
    `
    box.appendChild(div)
  }
}

async function refreshMe() {
  const data = await api('/api/me')
  state.me = data.me
  renderMe()
}

async function login() {
  const username = document.getElementById('username').value
  const password = document.getElementById('password').value
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
  document.getElementById('authCard').classList.add('hidden')
  document.getElementById('workspace').classList.remove('hidden')
  await refreshMe()
  await reloadDiscussions()
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' })
  location.reload()
}

async function createDiscussion() {
  const title = document.getElementById('discussionTitle').value
  const body = document.getElementById('discussionBody').value
  await api('/api/discussions', {
    method: 'POST',
    body: JSON.stringify({ title, body })
  })
  document.getElementById('discussionBody').value = ''
  await reloadDiscussions()
}

async function reloadDiscussions() {
  const data = await api('/api/discussions')
  renderDiscussions(data.discussions || [])
}

async function safeRun(fn) {
  try {
    await fn()
  } catch (error) {
    alert(error.message)
  }
}

document.getElementById('btnLogin').addEventListener('click', () => safeRun(login))
document.getElementById('btnLogout').addEventListener('click', () => safeRun(logout))
document.getElementById('btnCreateDiscussion').addEventListener('click', () => safeRun(createDiscussion))
document.getElementById('btnReloadDiscussion').addEventListener('click', () => safeRun(reloadDiscussions))

safeRun(async () => {
  await api('/api/bootstrap')
  try {
    await refreshMe()
    if (state.me && state.me.username) {
      document.getElementById('authCard').classList.add('hidden')
      document.getElementById('workspace').classList.remove('hidden')
      await reloadDiscussions()
    }
  } catch {
  }
  legacyPluginLoader()
  courseTopicHydration()
})
