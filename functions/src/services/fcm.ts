import { admin } from "./firestore";
import { logger } from "firebase-functions/v2";
import { LIMITS } from "../config/constants";
import { DeviceDocument } from "../types";

interface SendResult {
  deviceId: string;
  success: boolean;
  error?: string;
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  link?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: link ? { link } : undefined,
      android: {
        priority: "high",
        notification: {
          channelId: "weight_reminders",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.warn(`FCM send failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

export async function sendBatchNotifications(
  devices: DeviceDocument[],
  title: string,
  body: string,
  link?: string,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  // Process in batches to respect FCM limits
  for (let i = 0; i < devices.length; i += LIMITS.FCM_BATCH_SIZE) {
    const batch = devices.slice(i, i + LIMITS.FCM_BATCH_SIZE);

    const batchPromises = batch.map(async (device) => {
      const result = await sendPushNotification(device.fcmToken, title, body, link);
      return {
        deviceId: device.deviceId,
        success: result.success,
        error: result.error,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  logger.info(`Batch send complete: ${successCount} success, ${failCount} failed`);

  return results;
}
