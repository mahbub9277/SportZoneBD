import type { Request, Response } from 'express'
import { z } from 'zod'
import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../core/api-response.js'
import { getStreamRelaySwitchStatus, setStreamRelaySwitch } from '../../core/streamRelaySwitch.js'

const updateSchema = z.object({ enabled: z.boolean() }).strict()

/**
 * The HTTP stream relay switch for administrators.
 *
 * Reading reports what this instance has confirmed, plus whether the value could be confirmed at all: a
 * relay that cannot read its setting is reported as degraded and behaves as OFF rather than being shown as
 * ON and doing nothing. Writing goes through the switch itself, which persists, audits and applies the
 * change — and is the only way to change it, because the key is excluded from the generic settings update.
 */
const getStreamRelaySetting = asyncHandler(async (_req: Request, res: Response) => {
  const status = getStreamRelaySwitchStatus()
  res.status(200).json(successResponse(status))
})

const updateStreamRelaySetting = asyncHandler(async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Body must be { "enabled": boolean }.' })
    return
  }

  const actor = req.user as { id?: string; fullName?: string; name?: string } | undefined
  const result = await setStreamRelaySwitch(parsed.data.enabled, {
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? actor?.name ?? null,
    requestId: (req as Request & { id?: string }).id ?? null,
  })

  res.status(200).json(successResponse({
    ...result.status,
    // The value the caller asked for is the one that was persisted: the endpoint only reports the change
    // after the row is written and applied.
    enabled: parsed.data.enabled,
    previous: result.previous,
  }, parsed.data.enabled ? 'HTTP stream relay enabled.' : 'HTTP stream relay disabled.'))
})

export const streamRelayController = { getStreamRelaySetting, updateStreamRelaySetting }
