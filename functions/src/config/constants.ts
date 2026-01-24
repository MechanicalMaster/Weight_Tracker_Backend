// Configuration constants

export const COLLECTIONS = {
  DEVICES: "devices",
  NUDGES: "nudges",
  FOOD_ANALYSES: "food_analyses",
  EVENTS: "events",
  USERS: "users",
  NOTIFICATIONS: "notifications",
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

export const NUDGE_TYPES = {
  WEIGHT_REMINDER: {
    title: "Good morning! ⚖️",
    body: "Time to log your weight",
    link: "platewise://entry",
  },
  BREAKFAST: {
    title: "Breakfast time! 🍳",
    body: "Had breakfast? Snap a quick photo",
    link: "platewise://food/capture",
  },
  LUNCH: {
    title: "Lunch time! 🥗",
    body: "Capture what you're eating",
    link: "platewise://food/capture",
  },
  SNACKS: {
    title: "Snack check 🍎",
    body: "Snacking? Log it to stay on track",
    link: "platewise://food/capture",
  },
  DINNER: {
    title: "Dinner time! 🍽️",
    body: "Don't forget to log your meal",
    link: "platewise://food/capture",
  },
  EVENING_CHECKIN: {
    title: "Daily check-in 📊",
    body: "How was your day? Check your progress",
    link: "platewise://dashboard",
  },
} as const;

export const VISION_CONFIG = {
  MODEL: "gpt-4o",
  TEXT_MODEL: "gpt-4o", // Text-only model for Stage 2 (no vision capability needed)
  PERCEPTION_MAX_TOKENS: 384, // Stage 1: tight limit for perception-only
  NUTRITION_MAX_TOKENS: 512, // Stage 2: text-only nutrition estimation
  MAX_TOKENS: 2048, // Legacy: single-pass mode
  TIMEOUT_MS: 60000,
  SUPPORTED_FORMATS: ["image/jpeg", "image/png", "image/webp"],
  PROMPT_VERSION: "vision_v4_2stage",
  MIN_CONFIDENCE: 0.6, // Gate Stage 2 if perception confidence is below this
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

