import { z } from "zod";

// Device registration validation schema
export const deviceRegistrationSchema = z.object({
  deviceId: z
    .string()
    .min(1, "deviceId is required")
    .max(256, "deviceId too long"),
  fcmToken: z
    .string()
    .min(1, "fcmToken is required")
    .max(4096, "fcmToken too long"),
  platform: z.enum(["ios", "android"], {
    errorMap: () => ({ message: "platform must be 'ios' or 'android'" }),
  }),
  timezone: z.string().min(1).optional(),
  displayName: z.string().max(100).optional(),
});

// Food analysis validation schema (deviceId now optional, auth provides uid)
export const foodAnalysisSchema = z.object({
  image: z
    .string()
    .min(1, "image is required")
    .optional(),
});

// Backup data validation schema
export const backupSchema = z.object({
  weightEntries: z.array(z.unknown()).optional(),
  foodLogs: z.array(z.unknown()).optional(),
  streaks: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Notification preferences validation schema (per-type)
export const notificationPreferencesSchema = z
  .object({
    type: z.enum(["weight", "breakfast", "lunch", "dinner", "snacks"]),
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z
      .union([
        z.literal(0),
        z.literal(10),
        z.literal(20),
        z.literal(30),
        z.literal(40),
        z.literal(50),
      ])
      .optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      // If disabled, time fields are optional
      if (!data.enabled) return true;
      // If enabled, must have both hour+minute or neither
      const hasHour = data.hour !== undefined;
      const hasMinute = data.minute !== undefined;
      return hasHour === hasMinute;
    },
    { message: "Must provide both hour and minute, or neither" },
  );

// Type exports from schemas
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;
export type FoodAnalysisInput = z.infer<typeof foodAnalysisSchema>;
export type BackupInput = z.infer<typeof backupSchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

// Validation helper
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMessage = result.error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join(", ");
  return { success: false, error: errorMessage };
}

