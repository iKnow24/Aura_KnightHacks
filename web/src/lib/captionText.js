// Newest words of a caption that fit in about two lines of `perLine` characters.
export function lastTwoLines(text, perLine) {
  const max = perLine * 2
  if (text.length <= max) return text
  const cut = text.slice(-max)
  return '…' + cut.slice(cut.indexOf(' ') + 1)
}
