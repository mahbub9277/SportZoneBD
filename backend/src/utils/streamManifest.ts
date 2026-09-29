function resolvePlaylistUri(rawValue: string, baseUrl: string): string {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue || trimmedValue.startsWith('#')) {
    return rawValue
  }

  try {
    return new URL(trimmedValue, baseUrl).toString()
  } catch {
    return rawValue
  }
}

export function rewriteManifestBody(body: string, baseUrl: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) {
        return line
      }

      const uriMatch = trimmedLine.match(/URI="([^"]+)"/i)
      if (uriMatch) {
        const resolvedValue = resolvePlaylistUri(uriMatch[1], baseUrl)
        return line.replace(uriMatch[1], resolvedValue)
      }

      if (trimmedLine.startsWith('#')) {
        return line
      }

      return resolvePlaylistUri(trimmedLine, baseUrl)
    })
    .join('\n')
}