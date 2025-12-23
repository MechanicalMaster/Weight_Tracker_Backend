import { logger } from "firebase-functions/v2";
import { getActiveDevices, logNudge } from "../services/firestore";
import { sendBatchNotifications } from "../services/fcm";
import { NUDGE_CONFIG } from "../config/constants";

export async function sendDailyNudge(): Promise<void> {
  logger.info("Starting daily nudge job");

  try {
    // Get all active devices
    const devices = await getActiveDevices();
    logger.info(`Found ${devices.length} active devices`);

    if (devices.length === 0) {
      logger.info("No active devices to notify");
      return;
    }

    // Send notifications
    const results = await sendBatchNotifications(
      devices,
      NUDGE_CONFIG.DEFAULT_TITLE,
      NUDGE_CONFIG.DEFAULT_BODY,
    );

    // Log each nudge result
    const logPromises = results.map((result) =>
      logNudge({
        deviceId: result.deviceId,
        status: result.success ? "success" : "failed",
        title: NUDGE_CONFIG.DEFAULT_TITLE,
        body: NUDGE_CONFIG.DEFAULT_BODY,
        error: result.error,
      }),
    );

    await Promise.all(logPromises);

    const successCount = results.filter((r) => r.success).length;
    logger.info(`Daily nudge complete: ${successCount}/${results.length} successful`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Daily nudge failed: ${errorMessage}`);
    throw error;
  }
}
