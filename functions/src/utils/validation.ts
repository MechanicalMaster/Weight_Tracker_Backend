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
});

// Food analysis validation schema
export const foodAnalysisSchema = z.object({
  deviceId: z
    .string()
    .min(1, "deviceId is required")
    .max(256, "deviceId too long"),
  image: z
    .string()
    .min(1, "image is required")
    .optional(),
});

// Type exports from schemas
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;
export type FoodAnalysisInput = z.infer<typeof foodAnalysisSchema>;

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
