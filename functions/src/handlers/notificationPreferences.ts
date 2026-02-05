import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";
import { updateNotificationPref } from "../services/user";
import { notificationPreferencesSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { NotificationType } from "../config/constants";

/**
 * PATCH /users/notification-preferences
 *
 * Updates a single notification type preference.
 * Immediately recomputes nextNotificationUTC.
 *
 * Body: { type, enabled, hour?, minute?, timezone? }
 */
export async function updateNotificationPreferences(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    // Only allow PATCH
    if (req.method !== "PATCH") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    // Verify auth
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (res.headersSent) return;

    const uid = req.uid!;

    // Validate input
    const validation = validateInput(notificationPreferencesSchema, req.body);
    if (!validation.success) {
      throw errors.invalidRequest(validation.error);
    }

    const { type, enabled, hour, minute, timezone } = validation.data;

    logger.info(`Updating notification pref for user ${uid}`, {
      type,
      enabled,
      hasCustomTime: hour !== undefined,
    });

    // Update preference (this handles nextNotificationUTC recomputation)
    await updateNotificationPref(
      uid,
      {
        type: type as NotificationType,
        enabled,
        hour,
        minute,
      },
      timezone,
    );

    res.status(200).json({
      success: true,
      message: `${type} notification preference updated`,
    });
  } catch (error) {
    handleError(error, res);
  }
}
