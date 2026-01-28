import { logger } from "firebase-functions/v2";
import { getActiveDevices } from "../services/firestore";
import { sendBatchNotifications, PreparedNotification, SendResult } from "../services/fcm";
import { resolveContextBatch } from "../services/user";
import { trackEventAsync } from "../services/events";
import { TemplateId, renderTemplate, getTemplate } from "../config/templates";
import { COLLECTIONS, LIMITS } from "../config/constants";
import { EventName } from "../types/behavioral";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore();

// Chunk helper for batching
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Get today's date in YYYY-MM-DD format for idempotency
function getActiveDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Notification document structure
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
 * Factory function that creates a nudge handler for a specific template.
 * Uses the new personalization pipeline:
 * 1. Select devices
 * 2. Batch UIDs
 * 3. Resolve context
 * 4. Render templates
 * 5. Prepare payloads
 * 6. Deliver
 * 7. Log results
 */
export function createNudgeHandler(templateId: TemplateId) {
  return async function sendNudge(): Promise<void> {
    const template = getTemplate(templateId);
    const activeDate = getActiveDate();

    logger.info(`Starting ${templateId} nudge job`, { link: template.link });

    try {
      // 1. Select all active devices
      const devices = await getActiveDevices();
      logger.info(`Found ${devices.length} active devices`);

      if (devices.length === 0) {
        logger.info("No active devices to notify");
        return;
      }

      // 2. Extract unique UIDs and batch them
      const uidToDevices = new Map<string, typeof devices>();
      for (const device of devices) {
        const existing = uidToDevices.get(device.uid) || [];
        existing.push(device);
        uidToDevices.set(device.uid, existing);
      }
      const uniqueUids = Array.from(uidToDevices.keys());
      const uidBatches = chunk(uniqueUids, LIMITS.FCM_BATCH_SIZE);

      const allResults: SendResult[] = [];

      // Process each UID batch
      for (const uidBatch of uidBatches) {
        // 3. Resolve personalization context for batch
        const contextMap = await resolveContextBatch(uidBatch);

        // 4 & 5. Render templates and prepare payloads
        const payloads: PreparedNotification[] = [];

        for (const uid of uidBatch) {
          const context = contextMap.get(uid)!;
          const rendered = renderTemplate(template, context);
          const userDevices = uidToDevices.get(uid) || [];

          for (const device of userDevices) {
            // Idempotent notification ID: prevents duplicates on job retry
            const notificationId = `${template.id}_${activeDate}_${uid}_${device.deviceId}`;

            payloads.push({
              fcmToken: device.fcmToken,
              title: rendered.title,
              body: rendered.body,
              notificationId,
              link: template.link,
              deviceId: device.deviceId,
              uid: device.uid,
            });
          }
        }

        // 6. Deliver batch
        const results = await sendBatchNotifications(payloads);
        allResults.push(...results);

        // 7. Log each notification result
        const logPromises = results.map(async (result) => {
          const payload = payloads.find((p) => p.notificationId === result.notificationId)!;
          const deliveryStatus = result.success ? "success" : "failed";

          // Log to 'notifications' collection
          const notificationDoc: NotificationDocument = {
            notification_id: result.notificationId,
            device_id: result.deviceId,
            uid: result.uid,
            notification_type: templateId,
            title: payload.title,
            body: payload.body,
            link: template.link,
            delivery_status: deliveryStatus,
            ...(result.error && { error_message: result.error }),
            sent_at: Timestamp.now(),
          };

          await logNotification(notificationDoc);

          // Track NOTIFICATION_DELIVERED event (fire-and-forget)
          trackEventAsync({
            eventName: EventName.NOTIFICATION_DELIVERED,
            userId: result.uid,
            timestamp: new Date().toISOString(),
            timezone: "UTC",
            platform: "ios", // Default, we may add platform to device doc later
            metadata: {
              notification_id: result.notificationId,
              notification_type: templateId,
              delivery_status: deliveryStatus,
              device_id: result.deviceId,
              ...(result.error && { error_message: result.error }),
            },
          }).catch((err) => {
            logger.warn("Failed to track notification event", {
              notificationId: result.notificationId,
              error: err,
            });
          });
        });

        await Promise.all(logPromises);
      }

      const successCount = allResults.filter((r) => r.success).length;
      logger.info(`${templateId} nudge complete: ${successCount}/${allResults.length} successful`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${templateId} nudge failed: ${errorMessage}`);
      throw error;
    }
  };
}

// Export handlers using new template IDs
export const sendDailyNudge = createNudgeHandler("WEIGHT_REMINDER_V1");
export const sendBreakfastNudge = createNudgeHandler("BREAKFAST_V1");
export const sendLunchNudge = createNudgeHandler("LUNCH_V1");
export const sendSnacksNudge = createNudgeHandler("SNACKS_V1");
export const sendDinnerNudge = createNudgeHandler("DINNER_V1");
export const sendEveningCheckinNudge = createNudgeHandler("EVENING_CHECKIN_V1");
