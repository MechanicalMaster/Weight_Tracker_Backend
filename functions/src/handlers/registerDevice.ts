import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { upsertDevice } from "../services/firestore";
import { trackEventAsync } from "../services/events";
import { deviceRegistrationSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { EventName } from "../types/behavioral";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";

export async function registerDevice(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    // 1. VERIFY AUTH
    // This connects the request to the Firebase User (Anonymous or Gmail)
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (res.headersSent) return;

    const uid = req.uid!; // Securely obtained from token

    // 2. Validate input
    const validation = validateInput(deviceRegistrationSchema, req.body);
    if (!validation.success) {
      throw errors.invalidRequest(validation.error);
    }

    const { deviceId, fcmToken, platform, timezone } = validation.data;

    logger.info(`Registering device: ${deviceId} to User: ${uid}`);

    // 3. Upsert with UID
    await upsertDevice(uid, deviceId, fcmToken, platform);

    // 4. Track Event (Now properly attributed to the UID)
    if (timezone) {
      trackEventAsync({
        eventName: EventName.DEVICE_REGISTERED,
        userId: uid, // Use actual UID now, not deviceId
        timestamp: new Date().toISOString(),
        timezone,
        platform,
        metadata: {
          timezone,
          platform,
          deviceId, // Keep deviceId in metadata for debugging
        },
      }).catch((err) => {
        logger.warn("Failed to track device registration event", { error: err });
      });
    }

    res.status(200).json({
      success: true,
      message: "Device registered successfully",
    });
  } catch (error) {
    handleError(error, res);
  }
}

