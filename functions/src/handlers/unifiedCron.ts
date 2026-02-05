import { logger } from "firebase-functions/v2";
import { getActiveDevices } from "../services/firestore";
import {
  sendBatchNotifications,
  PreparedNotification,
  SendResult,
} from "../services/fcm";
import {
  getEligibleUsers,
  scheduleNextNotification,
  getWindowKey,
  resolveContextBatch,
} from "../services/user";
import { trackEventAsync } from "../services/events";
import { TemplateId, renderTemplate, getTemplate } from "../config/templates";
import { COLLECTIONS, NotificationType } from "../config/constants";
import { EventName } from "../types/behavioral";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore();

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
 * Map notification type to template ID
 */
const TYPE_TO_TEMPLATE: Record<NotificationType, TemplateId> = {
  weight: "WEIGHT_REMINDER_V1",
  breakfast: "BREAKFAST_V1",
  lunch: "LUNCH_V1",
  dinner: "DINNER_V1",
  snacks: "SNACKS_V1",
};

/**
 * Unified Notification Cron Handler
 *
 * Runs every 10 minutes. Uses single-index architecture:
 * 1. Query users where nextNotificationUTC <= now
 * 2. For each user, atomically update state (schedule next) BEFORE sending
 * 3. Send notifications for all due types
 * 4. Log results
 *
 * Idempotency: Uses window-based check (lastNotificationWindow)
 * Atomicity: State updated before send to prevent double-send on retry
 */
export async function sendUnifiedNotifications(): Promise<void> {
  const now = new Date();
  const windowKey = getWindowKey(now);

  logger.info("Starting unified notification cron", { window: windowKey });

  try {
    // 1. Query eligible users (single indexed query)
    const eligibleUsers = await getEligibleUsers();

    if (eligibleUsers.length === 0) {
      logger.info("No eligible users for notification");
      return;
    }

    // 2. Filter out users already processed in this window (idempotency)
    const usersToNotify = eligibleUsers.filter(
      (user) => user.lastNotificationWindow !== windowKey,
    );

    if (usersToNotify.length === 0) {
      logger.info("All eligible users already processed in this window");
      return;
    }

    logger.info(`Found ${usersToNotify.length} users to notify`);

    // 3. Get all active devices
    const allDevices = await getActiveDevices();
    const devicesByUid = new Map<string, typeof allDevices>();
    for (const device of allDevices) {
      const existing = devicesByUid.get(device.uid) || [];
      existing.push(device);
      devicesByUid.set(device.uid, existing);
    }

    // 4. Resolve personalization context
    const uids = usersToNotify.map((u) => u.uid);
    const contextMap = await resolveContextBatch(uids);

    // 5. Process each user: schedule next BEFORE sending (atomicity)
    const allPayloads: PreparedNotification[] = [];
    const payloadMeta: Array<{ uid: string; type: NotificationType }> = [];

    for (const user of usersToNotify) {
      // ATOMIC: Schedule next notification before sending
      await scheduleNextNotification(user.uid, windowKey);

      const context = contextMap.get(user.uid)!;
      const userDevices = devicesByUid.get(user.uid) || [];

      if (userDevices.length === 0) {
        logger.info(`User ${user.uid} has no active devices, skipping`);
        continue;
      }

      // Send all due notification types
      for (const type of user.notificationTypes) {
        const templateId = TYPE_TO_TEMPLATE[type];
        const template = getTemplate(templateId);
        const rendered = renderTemplate(template, context);

        for (const device of userDevices) {
          const notificationId = `${type}_${user.uid}_${windowKey}`;
          const payload: PreparedNotification = {
            fcmToken: device.fcmToken,
            title: rendered.title,
            body: rendered.body,
            notificationId,
            link: template.link,
            deviceId: device.deviceId,
            uid: user.uid,
          };
          allPayloads.push(payload);
          payloadMeta.push({ uid: user.uid, type });
        }
      }
    }

    if (allPayloads.length === 0) {
      logger.info("No payloads to send (users have no active devices)");
      return;
    }

    // 6. Send all notifications
    const allResults = await sendBatchNotifications(allPayloads);

    // 7. Log results and track events
    const logPromises = allResults.map(async (result: SendResult, index: number) => {
      const payload = allPayloads[index];
      const meta = payloadMeta[index];
      const deliveryStatus = result.success ? "success" : "failed";

      const notificationDoc: NotificationDocument = {
        notification_id: result.notificationId,
        device_id: result.deviceId,
        uid: result.uid,
        notification_type: meta.type.toUpperCase(),
        title: payload.title,
        body: payload.body,
        link: payload.link!,
        delivery_status: deliveryStatus,
        ...(result.error && { error_message: result.error }),
        sent_at: Timestamp.now(),
      };

      await logNotification(notificationDoc);

      // Track event
      trackEventAsync({
        eventName: EventName.NOTIFICATION_DELIVERED,
        userId: result.uid,
        timestamp: new Date().toISOString(),
        timezone: "UTC",
        platform: "ios",
        metadata: {
          notification_id: result.notificationId,
          notification_type: meta.type.toUpperCase(),
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

    const successCount = allResults.filter((r) => r.success).length;
    logger.info(`Unified notification cron complete: ${successCount}/${allResults.length} successful`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Unified notification cron failed: ${errorMessage}`);
    throw error;
  }
}
