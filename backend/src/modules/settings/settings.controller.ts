import type { Request, Response, NextFunction } from 'express'
import * as settingsService from './settings.service.js'
import { successResponse } from '../../core/api-response.js'
import { prisma } from '../../core/prisma.js'

interface RequestWithUser extends Request {
  user?: { id: string }
}

/**
 * @desc    Get notification preferences for the authenticated user
 * @route   GET /api/v1/settings/notification-preferences
 * @access  Private
 */
export async function getNotificationPreferences(req: RequestWithUser, res: Response, next: NextFunction) {
  try { 
    const userId = req.user!.id
    const preferences = await settingsService.findOrCreatePreferences(userId)
    res.status(200).json(successResponse(preferences));
  } catch (error) {
    next(error)
  }
}

/**
 * @desc    Update notification preferences for the authenticated user
 * @route   PATCH /api/v1/settings/notification-preferences
 * @access  Private
 */
export async function updateNotificationPreferences(req: RequestWithUser, res: Response, next: NextFunction) {
  try { 
    const userId = req.user!.id
    const updatedPreferences = await settingsService.updatePreferences(userId, req.body)
    res.status(200).json(successResponse(updatedPreferences, 'Preferences updated successfully'));
  } catch (error) {
    next(error)
  }
}

/**
 * @desc    Update user's own profile information
 * @route   PATCH /api/v1/settings/profile
 * @access  Private
 */
export async function updateMyProfile(req: RequestWithUser, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const { fullName } = req.body

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { fullName },
    })
    res.status(200).json(successResponse(updatedUser, 'Profile updated successfully'))
  } catch (error) {
    next(error)
  }
}