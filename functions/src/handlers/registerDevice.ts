import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { upsertDevice } from "../services/firestore";
import { trackEventAsync } from "../services/events";
import { deviceRegistrationSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { EventName } from "../types/behavioral";

export async function registerDevice(req: Request, res: Response): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    // Validate input
    const validation = validateInput(deviceRegistrationSchema, req.body);
    if (!validation.success) {
      throw errors.invalidRequest(validation.error);
    }

    const { deviceId, fcmToken, platform, timezone } = validation.data;

    logger.info(`Registering device: ${deviceId}`, { platform, timezone });

    // Upsert device in Firestore
    await upsertDevice(deviceId, fcmToken, platform);

    // Track DEVICE_REGISTERED event (fire-and-forget)
    if (timezone) {
      trackEventAsync({
        eventName: EventName.DEVICE_REGISTERED,
        userId: deviceId, // Use deviceId as userId for anonymous devices
        timestamp: new Date().toISOString(),
        timezone,
        platform,
        metadata: {
          timezone,
          platform,
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
