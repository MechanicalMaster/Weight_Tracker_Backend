import { admin } from "./firestore";
import { logger } from "firebase-functions/v2";
import { LIMITS } from "../config/constants";

/**
 * Prepared notification payload - fully rendered, ready for delivery.
 * FCM service is a "dumb" transport layer - it just sends what it receives.
 */
export interface PreparedNotification {
  fcmToken: string;
  title: string;
  body: string;
  notificationId: string;
  link?: string;
  // Metadata for logging (not sent to FCM)
  deviceId: string;
  uid: string;
}

/**
 * Result of sending a notification.
 */
export interface SendResult {
  deviceId: string;
  uid: string;
  notificationId: string;
  success: boolean;
  error?: string;
}

/**
 * Send a single push notification via FCM.
 */
export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  notificationId: string,
  link?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        notification_id: notificationId,
        ...(link && { link }),
      },
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

/**
 * Send batch notifications with prepared payloads.
 * This is a pure transport layer - payloads are already rendered with personalization.
 *
 * @param payloads Array of fully prepared notification payloads
 * @returns Array of send results
 */
export async function sendBatchNotifications(
  payloads: PreparedNotification[],
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  // Process in batches to respect FCM limits
  for (let i = 0; i < payloads.length; i += LIMITS.FCM_BATCH_SIZE) {
    const batch = payloads.slice(i, i + LIMITS.FCM_BATCH_SIZE);

    const batchPromises = batch.map(async (payload) => {
      const result = await sendPushNotification(
        payload.fcmToken,
        payload.title,
        payload.body,
        payload.notificationId,
        payload.link,
      );
      return {
        deviceId: payload.deviceId,
        uid: payload.uid,
        notificationId: payload.notificationId,
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
