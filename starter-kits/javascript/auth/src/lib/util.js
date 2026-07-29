// Generates a random string of a given length.
export function generateRandomStr (length) {
  const values = new Uint8Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

// Returns true if the given path is safe to use as a same-origin redirect
// target, i.e. it can't be interpreted as a protocol-relative or malformed
// URL pointing off-site (e.g. "//evil.com/phish").
export function isSafeRedirectTarget (path) {
  return path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    ![...path].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
}
