import { logger } from "firebase-functions/v2";
import { randomUUID } from "crypto";
import { getActiveDevices } from "../services/firestore";
import { sendBatchNotifications } from "../services/fcm";
import { trackEventAsync } from "../services/events";
import { NUDGE_TYPES, COLLECTIONS } from "../config/constants";
import { EventName } from "../types/behavioral";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore();

export type NudgeType = keyof typeof NUDGE_TYPES;

/**
 * Notification document structure (new collection)
 */
interface NotificationDocument {
  notification_id: string;
  device_id: string;
  uid: string;
  notification_type: string;
  title: string;
  body: string;
  link: string;
  delivery_status: "success" | "failed";
  error_message?: string;
  sent_at: FirebaseFirestore.Timestamp;
}

/**
 * Log notification to 'notifications' collection
 */
async function logNotification(notification: NotificationDocument): Promise<void> {
  await db.collection(COLLECTIONS.NOTIFICATIONS).add(notification);
}

/**
 * Factory function that creates a nudge handler for a specific type.
 * Each nudge type has its own title, body, and deep link.
 */
export function createNudgeHandler(nudgeType: NudgeType) {
  return async function sendNudge(): Promise<void> {
    const config = NUDGE_TYPES[nudgeType];
    logger.info(`Starting ${nudgeType} nudge job`, { link: config.link });

    try {
      // Get all active devices
      const devices = await getActiveDevices();
      logger.info(`Found ${devices.length} active devices`);

      if (devices.length === 0) {
        logger.info("No active devices to notify");
        return;
      }

      // Send notifications with deep link
      const results = await sendBatchNotifications(
        devices,
        config.title,
        config.body,
        config.link,
      );

      // Log each notification result and track events
      const logPromises = results.map(async (result) => {
        const notificationId = randomUUID();
        const deliveryStatus = result.success ? "success" : "failed";

        // Log to 'notifications' collection (replaces 'nudges')
        const notificationDoc: NotificationDocument = {
          notification_id: notificationId,
          device_id: result.deviceId,
          uid: result.uid,
          notification_type: nudgeType,
          title: config.title,
          body: config.body,
          link: config.link,
          delivery_status: deliveryStatus,
          error_message: result.error,
          sent_at: Timestamp.now(),
        };

        await logNotification(notificationDoc);

        // Track NOTIFICATION_DELIVERED event (fire-and-forget)
        trackEventAsync({
          eventName: EventName.NOTIFICATION_DELIVERED,
          userId: result.uid, // Use uid for user-level attribution
          timestamp: new Date().toISOString(),
          timezone: "UTC",
          platform: "ios", // Default, we don't know the platform here
          metadata: {
            notification_id: notificationId,
            notification_type: nudgeType,
            delivery_status: deliveryStatus,
            device_id: result.deviceId, // Keep deviceId for debugging
            error_message: result.error,
          },
        }).catch((err) => {
          logger.warn("Failed to track notification event", {
            notificationId,
            error: err,
          });
        });
      });

      await Promise.all(logPromises);

      const successCount = results.filter((r) => r.success).length;
      logger.info(`${nudgeType} nudge complete: ${successCount}/${results.length} successful`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${nudgeType} nudge failed: ${errorMessage}`);
      throw error;
    }
  };
}

// Legacy export for backward compatibility
export const sendDailyNudge = createNudgeHandler("WEIGHT_REMINDER");
