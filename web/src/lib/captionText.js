// "Hi, my name is sharan" -> "Sharan". Weak cues ("I'm going") are not names.
const MY_NAME_IS = /\bmy name is\s+([a-z]{3,})/i
const NAME_RE = /\b(?:[Mm]y name's|[Nn]ame's|I'm|I am|[Cc]all me|[Tt]his is)\s+([A-Z][a-z]{2,})/
const NOT_NAMES = new Set(['Going', 'Not', 'Just', 'Sure', 'Sorry', 'Good', 'Fine', 'Okay', 'So', 'Here', 'Really', 'Glad',
  'Done', 'Back', 'Trying', 'Looking', 'Talking', 'Very', 'The', 'From', 'Your', 'What', 'Lumen'])

export function nameIn(text) {
  const m = String(text || '').match(MY_NAME_IS)?.[1] ?? String(text || '').match(NAME_RE)?.[1]
  if (!m) return null
  const name = m[0].toUpperCase() + m.slice(1).toLowerCase()
  return NOT_NAMES.has(name) ? null : name
}

// This phone's mic keeps the last name someone introduced, until a new one is said.
let rememberedVoice = null
export function voiceForLine(text) {
  const said = nameIn(text)
  if (said) rememberedVoice = said
  return said || rememberedVoice
}

// Newest words of a caption that fit in about two lines of `perLine` characters.
export function lastTwoLines(text, perLine) {
  const max = perLine * 2
  if (text.length <= max) return text
  const cut = text.slice(-max)
  return '…' + cut.slice(cut.indexOf(' ') + 1)
}
