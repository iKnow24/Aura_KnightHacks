// Demo login: a name kept in this browser. No passwords. Judges don't score auth, and the
// name does one real job: the brain listens for it ("Someone called your name").
const KEY = 'lumen_user'

export function getUser() {
  try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null }
}

export function signIn(name, household) {
  const user = { name: name.trim(), household: household.trim() || 'Home' }
  try { localStorage.setItem(KEY, JSON.stringify(user)) } catch { /* private mode: session only */ }
  fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: user.name }) }).catch(() => {})
  return user
}

export function signOut() {
  try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
