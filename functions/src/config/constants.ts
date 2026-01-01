// Configuration constants

export const COLLECTIONS = {
  DEVICES: "devices",
  NUDGES: "nudges",
  FOOD_ANALYSES: "food_analyses",
} as const;

export const LIMITS = {
  MAX_IMAGE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
  DEVICE_ACTIVE_DAYS: 30, // Consider device active if seen within this many days
  FCM_BATCH_SIZE: 500, // Max devices per FCM batch
} as const;

export const NUDGE_CONFIG = {
  DEFAULT_TITLE: "Time to log your weight! ⚖️",
  DEFAULT_BODY: "Consistency is key! Take a moment to log your weight today.",
} as const;

export const VISION_CONFIG = {
  MODEL: "gpt-5.2",
  MAX_TOKENS: 2048,
  TIMEOUT_MS: 60000,
  SUPPORTED_FORMATS: ["image/jpeg", "image/png", "image/webp"],
  PROMPT_VERSION: "vision_v3_canonical_singlepass",
} as const;

export const FUNCTION_CONFIG = {
  REGION: "us-central1",
  TIMEOUT_SECONDS: 60,
  MEMORY: "256MiB" as const,
  ANALYSIS_MEMORY: "512MiB" as const,
} as const;

export const BACKUP_CONFIG = {
  STORAGE_BUCKET: process.env.STORAGE_BUCKET || "",
  STORAGE_PATH_PREFIX: "users",
  BACKUP_FILENAME: "current.gz",
} as const;

