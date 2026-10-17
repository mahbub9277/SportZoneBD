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

export interface ManifestRewriteOptions {
  /**
   * Maps a resolved resource URL to the URL the browser should request instead, or returns null to keep it.
   *
   * The relay uses this to serve an authorized `http://` resource over the site's own HTTPS origin: leaving
   * it absolute would make the browser refuse it as mixed content. Returning null keeps the provider URL
   * untouched, which is what happens for every HTTPS resource and every non-allowlisted host.
   */
  relayHref?: (resourceUrl: string) => string | null
}

export function rewriteManifestBody(body: string, baseUrl: string, options: ManifestRewriteOptions = {}): string {
  const rewriteUri = (rawValue: string): string => {
    // An empty reference or a tag is not a resource, so there is nothing to resolve or relay.
    if (!rawValue.trim() || rawValue.trim().startsWith('#')) return rawValue

    const resolvedValue = resolvePlaylistUri(rawValue, baseUrl)
    if (!options.relayHref) return resolvedValue

    return options.relayHref(resolvedValue) ?? resolvedValue
  }

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) {
        return line
      }

      const uriMatch = trimmedLine.match(/URI="([^"]+)"/i)
      if (uriMatch) {
        return line.replace(uriMatch[1], rewriteUri(uriMatch[1]))
      }

      if (trimmedLine.startsWith('#')) {
        return line
      }

      return rewriteUri(trimmedLine)
    })
    .join('\n')
}