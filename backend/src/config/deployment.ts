/**
 * Deployment topology switch for the Redis-backed coordination layers.
 *
 * Two subsystems exist purely so that several backend instances can see each other's state:
 * the Socket.IO Redis adapter (cross-instance broadcasts) and the shared HLS manifest cache
 * (a manifest one instance resolved is reused by another). Neither has any effect while a single
 * instance serves every request, and both cost Redis commands per event: one PUBLISH per broadcast
 * and one GET plus one SET per manifest refresh.
 *
 * The default keeps the multi-instance behaviour, so scaling out can never silently lose
 * cross-instance delivery. A deployment that is known to run exactly one instance can declare that
 * with MULTI_INSTANCE_ENABLED=false and stop paying those commands.
 */
const SINGLE_INSTANCE_VALUES = ['false', '0', 'off', 'no', 'none', 'disabled']

export function resolveMultiInstanceEnabled(value: string | undefined = process.env.MULTI_INSTANCE_ENABLED): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return true
  return !SINGLE_INSTANCE_VALUES.includes(normalized)
}

/** Resolved once per process: the topology cannot change while the server is running. */
export const isMultiInstanceDeployment = resolveMultiInstanceEnabled()
