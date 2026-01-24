/**
 * Event Service - Transactional Event Tracking
 *
 * Implements idempotent event writes with derived state computation.
 */
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomUUID } from "crypto";
import {
  EventName,
  EventPayloads,
  EventDocument,
  TrackEventResult,
  ROOT_SCHEMA_VERSION,
} from "../types/behavioral";
import { COLLECTIONS } from "../config/constants";

const db = getFirestore();

/**
 * Compute local date string from timestamp and timezone
 */
function getLocalDate(timestamp: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(timestamp);
  } catch {
    // Fallback to UTC if timezone is invalid
    return timestamp.toISOString().split("T")[0];
  }
}

/**
 * Compute streak based on date difference
 */
function computeStreak(
  currentStreak: number,
  lastLogDate: string | null,
  newLogDate: string,
): number {
  if (!lastLogDate) {
    return 1; // First log ever
  }

  const last = new Date(lastLogDate);
  const current = new Date(newLogDate);
  const diffDays = Math.floor(
    (current.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) {
    // Same day, streak remains
    return currentStreak;
  } else if (diffDays === 1) {
    // Consecutive day, increment streak
    return currentStreak + 1;
  } else {
    // Gap > 1 day, reset streak
    return 1;
  }
}

interface TrackEventParams {
    eventId: string;
    eventName: EventName;
    userId: string;
    timestamp: string; // ISO 8601
    timezone: string;
    sessionId: string;
    platform: "ios" | "android";
    metadata: Record<string, unknown>;
}

/**
 * Track an event transactionally with idempotency and derived state.
 *
 * Logic Flow (inside transaction):
 * 1. Idempotency Check: Read events/{eventId}. If exists, return duplicate.
 * 2. Read User State: Read users/{userId}.
 * 3. Compute Derived State for WEIGHT_LOGGED.
 * 4. Prepare Writes: set Event doc, update User doc.
 */
export async function trackEventTx(
  params: TrackEventParams,
): Promise<TrackEventResult> {
  const { eventId, eventName, userId, timestamp, timezone, sessionId, platform, metadata } = params;

  // Validate metadata against schema
  const metadataSchema = EventPayloads[eventName];
  if (metadataSchema) {
    const parseResult = metadataSchema.safeParse(metadata);
    if (!parseResult.success) {
      logger.warn("Invalid event metadata", {
        eventName,
        errors: parseResult.error.errors,
      });
      throw new Error(`Invalid metadata for ${eventName}: ${parseResult.error.message}`);
    }
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

  const eventTimestamp = new Date(timestamp);
  const localDate = getLocalDate(eventTimestamp, timezone);

  const result = await db.runTransaction(async (transaction) => {
    // 1. Idempotency check
    const existingEvent = await transaction.get(eventRef);
    if (existingEvent.exists) {
      logger.info("Duplicate event detected", { eventId });
      return { status: "duplicate" as const, eventId };
    }

    // 2. Read user state
    const userDoc = await transaction.get(userRef);
    const userData = userDoc.exists ? userDoc.data() : null;

    // 3. Compute derived state for WEIGHT_LOGGED
    let streakUpdate: Record<string, unknown> = {};
    if (eventName === EventName.WEIGHT_LOGGED) {
      const currentStreak = userData?.current_streak ?? 0;
      const lastLogDate = userData?.last_log_date ?? null;
      const newStreak = computeStreak(currentStreak, lastLogDate, localDate);

      streakUpdate = {
        current_streak: newStreak,
        last_log_date: localDate,
        total_logs: FieldValue.increment(1),
      };

      logger.info("Streak computed", {
        userId,
        lastLogDate,
        newLogDate: localDate,
        oldStreak: currentStreak,
        newStreak,
      });
    }

    // 4. Prepare event document
    const eventDoc: EventDocument = {
      event_id: eventId,
      user_id: userId,
      event_name: eventName,
      event_timestamp_utc: Timestamp.fromDate(eventTimestamp),
      event_local_date: localDate,
      ingested_at: Timestamp.now(),
      timezone,
      session_id: sessionId,
      platform,
      metadata,
      schema_version: ROOT_SCHEMA_VERSION,
      metadata_version: 1,
    };

    // 5. Write event
    transaction.set(eventRef, eventDoc);

    // 6. Update user document
    if (userDoc.exists) {
      transaction.update(userRef, {
        ...streakUpdate,
        timezone,
        last_active_at: FieldValue.serverTimestamp(),
      });
    } else {
      // Initialize user behavioral state
      transaction.set(
        userRef,
        {
          ...streakUpdate,
          current_streak: streakUpdate.current_streak ?? 0,
          last_log_date: streakUpdate.last_log_date ?? null,
          total_logs: 0,
          timezone,
          last_active_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    logger.info("Event tracked", { eventId, eventName, userId });
    return { status: "created" as const, eventId };
  });

  return result;
}

/**
 * Helper to generate a new event ID
 */
export function generateEventId(): string {
  return randomUUID();
}

/**
 * Track event without transaction (fire-and-forget for internal use)
 * Used for non-critical events where idempotency is less important.
 */
export async function trackEventAsync(
  params: Omit<TrackEventParams, "eventId" | "sessionId"> & {
        eventId?: string;
        sessionId?: string;
    },
): Promise<void> {
  const eventId = params.eventId ?? generateEventId();
  const sessionId = params.sessionId ?? "server-generated";

  try {
    await trackEventTx({
      ...params,
      eventId,
      sessionId,
    });
  } catch (error) {
    // Log but don't throw - this is fire-and-forget
    logger.error("Failed to track event async", {
      eventId,
      eventName: params.eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
