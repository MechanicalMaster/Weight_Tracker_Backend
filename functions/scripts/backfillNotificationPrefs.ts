/**
 * Backfill Script: Initialize notification preferences for existing users
 *
 * This script:
 * 1. Queries all users without notificationPrefs set
 * 2. Populates default preferences based on NOTIFICATION_CONFIG.DEFAULTS
 * 3. Computes and sets nextNotificationUTC for each user
 *
 * Run this BEFORE deploying the unified cron.
 *
 * Usage: npx ts-node scripts/backfillNotificationPrefs.ts
 */

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Initialize Firebase Admin using Application Default Credentials
// (Uses firebase login credentials from CLI)
if (getApps().length === 0) {
    initializeApp({
        credential: applicationDefault(),
        projectId: "platewise-b8995",
    });
}

const db = getFirestore();

// Notification config (duplicated here for standalone script)
const NOTIFICATION_CONFIG = {
    DEFAULT_TIMEZONE: "Asia/Kolkata",
    TYPES: ["weight", "breakfast", "lunch", "dinner", "snacks"] as const,
    DEFAULTS: {
        weight: { enabled: true, hour: 7, minute: 30 },
        breakfast: { enabled: true, hour: 8, minute: 30 },
        lunch: { enabled: true, hour: 13, minute: 0 },
        snacks: { enabled: true, hour: 17, minute: 0 },
        dinner: { enabled: true, hour: 20, minute: 30 },
    },
} as const;

type NotificationType = (typeof NOTIFICATION_CONFIG.TYPES)[number];

interface NotificationPref {
    enabled: boolean;
    hour: number;
    minute: number;
}

/**
 * Convert local time to next UTC timestamp
 */
function localTimeToNextUTC(
    hour: number,
    minute: number,
    timezone: string
): Date {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type: string): number =>
        parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

    const localHour = getPart("hour");
    const localMinute = getPart("minute");

    // Calculate timezone offset
    const testDate = new Date();
    const utcHour = testDate.getUTCHours();
    const tzFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
    });
    const tzHour = parseInt(tzFormatter.format(testDate), 10);
    const offsetHours = tzHour - utcHour;

    let targetUTCHour = hour - offsetHours;
    if (targetUTCHour < 0) targetUTCHour += 24;
    if (targetUTCHour >= 24) targetUTCHour -= 24;

    const targetDate = new Date();
    targetDate.setUTCHours(targetUTCHour, minute, 0, 0);

    const hasPassed =
        localHour > hour || (localHour === hour && localMinute >= minute);
    if (hasPassed) {
        targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    }

    return targetDate;
}

/**
 * Compute next notification
 */
function computeNextNotification(
    prefs: Record<NotificationType, NotificationPref>,
    timezone: string
): { nextUTC: Date | null; types: NotificationType[] } {
    const candidates: Array<{ type: NotificationType; nextUTC: Date }> = [];

    for (const type of NOTIFICATION_CONFIG.TYPES) {
        const pref = prefs[type];
        if (!pref?.enabled) continue;

        const nextUTC = localTimeToNextUTC(pref.hour, pref.minute, timezone);
        candidates.push({ type, nextUTC });
    }

    if (candidates.length === 0) {
        return { nextUTC: null, types: [] };
    }

    const minTime = Math.min(...candidates.map((c) => c.nextUTC.getTime()));
    const types = candidates
        .filter((c) => c.nextUTC.getTime() === minTime)
        .map((c) => c.type);

    return { nextUTC: new Date(minTime), types };
}

/**
 * Main backfill function
 */
async function backfillNotificationPrefs(): Promise<void> {
    console.log("Starting notification preferences backfill...");

    const usersSnapshot = await db.collection("users").get();
    console.log(`Found ${usersSnapshot.size} total users`);

    let processed = 0;
    let skipped = 0;

    const batchSize = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of usersSnapshot.docs) {
        const data = doc.data();

        // Skip if already has notification prefs
        if (data.notificationPrefs) {
            skipped++;
            continue;
        }

        const timezone = data.timezone || NOTIFICATION_CONFIG.DEFAULT_TIMEZONE;
        const defaultPrefs = { ...NOTIFICATION_CONFIG.DEFAULTS };

        const { nextUTC, types } = computeNextNotification(defaultPrefs, timezone);

        const updateData: Record<string, unknown> = {
            notificationPrefs: defaultPrefs,
            updatedAt: Timestamp.now(),
        };

        if (nextUTC) {
            updateData.nextNotificationUTC = Timestamp.fromDate(nextUTC);
            updateData.nextNotificationTypes = types;
        }

        batch.update(doc.ref, updateData);
        batchCount++;
        processed++;

        // Commit batch every 500 operations
        if (batchCount >= batchSize) {
            await batch.commit();
            console.log(`Committed batch of ${batchCount} users`);
            batch = db.batch();
            batchCount = 0;
        }
    }

    // Commit remaining
    if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${batchCount} users`);
    }

    console.log(`\nBackfill complete!`);
    console.log(`  Processed: ${processed} users`);
    console.log(`  Skipped (already had prefs): ${skipped} users`);
}

// Run
backfillNotificationPrefs()
    .then(() => {
        console.log("Done!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Backfill failed:", error);
        process.exit(1);
    });
