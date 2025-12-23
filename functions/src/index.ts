import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { registerDevice } from "./handlers/registerDevice";
import { sendDailyNudge } from "./handlers/sendDailyNudge";
import { analyzeFoodImage } from "./handlers/analyzeFoodImage";
import { FUNCTION_CONFIG } from "./config/constants";

// Set global options for all functions
setGlobalOptions({
  region: FUNCTION_CONFIG.REGION,
  timeoutSeconds: FUNCTION_CONFIG.TIMEOUT_SECONDS,
});

/**
 * Device Registration Endpoint
 * POST /register-device
 *
 * Registers or updates a device for push notifications.
 * Uses deviceId as the primary identifier (no Firebase Auth).
 */
export const registerDeviceFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
  },
  registerDevice,
);

/**
 * Daily Weight Reminder
 * Scheduled to run at 9:00 AM UTC every day
 *
 * Sends push notifications to all active devices reminding
 * users to log their weight.
 */
export const dailyNudge = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "UTC",
    memory: FUNCTION_CONFIG.MEMORY,
  },
  sendDailyNudge,
);

/**
 * Food Image Analysis Endpoint
 * POST /analyze-food-image
 *
 * Accepts a food image and returns estimated nutrition data
 * using GPT-4 Vision.
 */
export const analyzeFoodImageFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.ANALYSIS_MEMORY,
    timeoutSeconds: 60,
    cors: true,
  },
  analyzeFoodImage,
);
