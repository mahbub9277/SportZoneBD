export interface StreamSourceInput {
  sourceType?: string | null
  primaryUrl?: string | null
  backupUrl?: string | null
  /**
   * The current URL of the channel this stream is linked to, when it has one.
   *
   * A channel-sourced stream stores a copy of that URL, but the channel stays the authority: the copy is
   * only what the link was made with, so a channel whose URL is later corrected would otherwise be played
   * from the stale copy for as long as nobody edits the stream again.
   */
  channelUrl?: string | null
}

export interface StreamSourceUrls {
  /** The URL served for `type=primary`. */
  primaryUrl: string
  /** The URL served for `type=backup`, or null when the stream has none configured. */
  backupUrl: string | null
  /**
   * Every URL that belongs to this stream, which is the trusted set the SSRF guard validates against.
   *
   * It contains both the URL actually served and the stored copy it replaced, so a channel link whose
   * channel URL changed does not turn the stream's own previous URL into an untrusted target.
   */
  trustedUrls: string[]
}

const trimmed = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '')

export function resolveStreamSourceUrls(stream: StreamSourceInput | null | undefined): StreamSourceUrls {
  const storedPrimaryUrl = trimmed(stream?.primaryUrl)
  const channelPrimaryUrl = stream?.sourceType === 'CHANNEL' ? trimmed(stream?.channelUrl) : ''
  const primaryUrl = channelPrimaryUrl || storedPrimaryUrl
  const backupUrl = trimmed(stream?.backupUrl) || null

  return {
    primaryUrl,
    backupUrl,
    trustedUrls: [...new Set([primaryUrl, storedPrimaryUrl, backupUrl].filter((value): value is string => Boolean(value)))],
  }
}
