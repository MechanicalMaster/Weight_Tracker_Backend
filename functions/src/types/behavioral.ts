/**
 * Behavioral Types and Schemas for Event-Sourced Architecture
 * @version 1.0.0
 */
import { z } from "zod";

// Root schema version enforced on all events
export const ROOT_SCHEMA_VERSION = 1;

/**
 * Event Names - all trackable user behaviors
 */
export enum EventName {
  DEVICE_REGISTERED = "DEVICE_REGISTERED",
  WEIGHT_LOGGED = "WEIGHT_LOGGED",
  FOOD_ANALYZED = "FOOD_ANALYZED",
  NOTIFICATION_DELIVERED = "NOTIFICATION_DELIVERED",
  NOTIFICATION_RECEIVED = "NOTIFICATION_RECEIVED",
  NOTIFICATION_OPENED = "NOTIFICATION_OPENED",
  INTENT_CAPTURED = "INTENT_CAPTURED",
  INTENT_CLOSED = "INTENT_CLOSED",
}

/**
 * Event Metadata Schemas
 */
export const DeviceRegisteredMetadata = z.object({
  timezone: z.string().min(1),
  platform: z.enum(["ios", "android"]),
  app_version: z.string().optional(),
});

export const WeightLoggedMetadata = z.object({
  weight_value: z.number().positive(),
  unit: z.enum(["kg", "lbs"]).default("kg"),
  source: z.enum(["manual", "auto"]).default("manual"),
});

export const FoodAnalyzedMetadata = z.object({
  success: z.boolean(),
  food_detected: z.boolean(),
  credits_remaining: z.number().int().min(0),
  latency_ms: z.number().int().min(0),
});

export const NotificationDeliveredMetadata = z.object({
  notification_id: z.string().uuid(),
  notification_type: z.string().min(1),
  delivery_status: z.enum(["success", "failed"]),
  error_message: z.string().optional(),
});

export const NotificationReceivedMetadata = z.object({
  notification_id: z.string().uuid(),
  received_at: z.string().datetime(),
});

export const NotificationOpenedMetadata = z.object({
  notification_id: z.string().uuid(),
  opened_at: z.string().datetime(),
});

export const IntentCapturedMetadata = z.object({
  intent_type: z.string().min(1),
  expected_duration: z.number().int().min(0), // in minutes
});

export const IntentClosedMetadata = z.object({
  intent_type: z.string().min(1),
  outcome: z.enum(["completed", "abandoned", "expired"]),
  actual_duration: z.number().int().min(0), // in minutes
  expected_duration: z.number().int().min(0), // in minutes
});

/**
 * Event Payloads mapping - used for runtime validation
 */
export const EventPayloads = {
  [EventName.DEVICE_REGISTERED]: DeviceRegisteredMetadata,
  [EventName.WEIGHT_LOGGED]: WeightLoggedMetadata,
  [EventName.FOOD_ANALYZED]: FoodAnalyzedMetadata,
  [EventName.NOTIFICATION_DELIVERED]: NotificationDeliveredMetadata,
  [EventName.NOTIFICATION_RECEIVED]: NotificationReceivedMetadata,
  [EventName.NOTIFICATION_OPENED]: NotificationOpenedMetadata,
  [EventName.INTENT_CAPTURED]: IntentCapturedMetadata,
  [EventName.INTENT_CLOSED]: IntentClosedMetadata,
} as const;

/**
 * Base Event Request Schema (from client)
 */
export const EventRequestSchema = z.object({
  eventId: z.string().uuid(),
  eventName: z.nativeEnum(EventName),
  timestamp: z.string().datetime(),
  timezone: z.string().min(1),
  sessionId: z.string().uuid(),
  platform: z.enum(["ios", "android"]),
  metadata: z.record(z.unknown()),
});

export type EventRequest = z.infer<typeof EventRequestSchema>;

/**
 * Internal Event Document (stored in Firestore)
 */
export interface EventDocument {
  event_id: string;
  user_id: string;
  event_name: EventName;
  event_timestamp_utc: FirebaseFirestore.Timestamp;
  event_local_date: string; // YYYY-MM-DD in user's timezone
  ingested_at: FirebaseFirestore.Timestamp;
  timezone: string;
  session_id: string;
  platform: "ios" | "android";
  metadata: Record<string, unknown>;
  schema_version: number;
  metadata_version: number;
}

/**
 * User behavioral state (stored on user document)
 */
export interface UserBehavioralState {
  current_streak: number;
  last_log_date: string | null; // YYYY-MM-DD
  timezone: string;
  total_logs: number;
  last_active_at: FirebaseFirestore.Timestamp;
}

/**
 * Track event result
 */
export interface TrackEventResult {
  status: "created" | "duplicate";
  eventId: string;
}

// Type inference helpers
export type DeviceRegisteredMeta = z.infer<typeof DeviceRegisteredMetadata>;
export type WeightLoggedMeta = z.infer<typeof WeightLoggedMetadata>;
export type FoodAnalyzedMeta = z.infer<typeof FoodAnalyzedMetadata>;
export type NotificationDeliveredMeta = z.infer<typeof NotificationDeliveredMetadata>;
export type NotificationReceivedMeta = z.infer<typeof NotificationReceivedMetadata>;
export type NotificationOpenedMeta = z.infer<typeof NotificationOpenedMetadata>;
export type IntentCapturedMeta = z.infer<typeof IntentCapturedMetadata>;
export type IntentClosedMeta = z.infer<typeof IntentClosedMetadata>;
