/**
 * The playback URL for a source, resolving whether it goes through the manifest proxy.
 *
 * The proxy is only used for a real **stream** record: `/api/v1/stream/proxy` resolves `streamId`
 * against the stream table, so anything else (a channel or match id, or no id at all) is played
 * directly. Passing a non-stream id produced a request the backend could only answer with 404, and the
 * player then spent its primary/backup attempts on requests that could never succeed.
 */
export function buildHlsPlaybackUrl(options: {
  url: string | null | undefined
  streamId?: string | null
  usedBackup: boolean
  forceDirectUrl: boolean
}): string | null {
  const { url, streamId, usedBackup, forceDirectUrl } = options
  if (!url) return null
  if (!streamId || forceDirectUrl) return url

  const params = new URLSearchParams({
    streamId,
    type: usedBackup ? 'backup' : 'primary',
    url,
  })

  return `/api/v1/stream/proxy?${params.toString()}`
}
