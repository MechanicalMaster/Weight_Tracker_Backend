import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { upsertDevice } from "../services/firestore";
import { deviceRegistrationSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";

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

    const { deviceId, fcmToken, platform } = validation.data;

    logger.info(`Registering device: ${deviceId}`, { platform });

    // Upsert device in Firestore
    await upsertDevice(deviceId, fcmToken, platform);

    res.status(200).json({
      success: true,
      message: "Device registered successfully",
    });
  } catch (error) {
    handleError(error, res);
  }
}
