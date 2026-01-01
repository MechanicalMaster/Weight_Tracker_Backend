import { z } from "zod";

// =============================================================================
// Error Types
// =============================================================================

export const VisionErrorTypeSchema = z.enum([
  "NOT_FOOD",
  "BLURRY",
  "LOW_CONFIDENCE",
  "MULTIPLE_ITEMS",
]);
export type VisionErrorType = z.infer<typeof VisionErrorTypeSchema>;

export const VisionErrorSchema = z.object({
  error: z.string(),
  errorType: VisionErrorTypeSchema,
});
export type VisionError = z.infer<typeof VisionErrorSchema>;

// =============================================================================
// Debug / Confidence
// =============================================================================

export const ItemDebugSchema = z.object({
  confidence: z.number().min(0).max(1),
  visualCues: z.array(z.string()),
});
export type ItemDebug = z.infer<typeof ItemDebugSchema>;

// =============================================================================
// Food Item (per-item nutrition)
// =============================================================================

export const FoodItemSchema = z.object({
  foodName: z.string(),
  estimatedWeight_g: z.number().positive(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  // Latent canonical attributes (not exposed in reasoning)
  _canonical: z.object({
    cuisine: z.string(),
    baseIngredients: z.array(z.string()),
    cookingMethod: z.string(),
    density: z.enum(["low", "medium", "high"]),
    moisture: z.enum(["dry", "moist", "wet"]),
    processingLevel: z.enum(["raw", "minimal", "processed", "ultra-processed"]),
  }),
  _debug: ItemDebugSchema,
});
export type FoodItem = z.infer<typeof FoodItemSchema>;

// =============================================================================
// Vision Pass Result (multi-item response)
// =============================================================================

export const VisionPassResultSchema = z.object({
  items: z.array(FoodItemSchema).min(1).max(5),
  totalWeight_g: z.number().positive(),
  totalCalories: z.number().nonnegative(),
});
export type VisionPassResult = z.infer<typeof VisionPassResultSchema>;

// =============================================================================
// Combined Response (success or error)
// =============================================================================

export const VisionResponseSchema = z.union([
  VisionPassResultSchema,
  VisionErrorSchema,
]);
export type VisionResponse = z.infer<typeof VisionResponseSchema>;

// =============================================================================
// Persistence: Analysis Record (Firestore)
// =============================================================================

export const AnalysisStatusSchema = z.enum([
  "SINGLE_PASS",
  "TWO_PASS_AGREED",
  "TWO_PASS_DIVERGED",
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const DivergenceReasonSchema = z.enum([
  "CALORIES",
  "WEIGHT",
  "ITEM_MISMATCH",
]).optional();
export type DivergenceReason = z.infer<typeof DivergenceReasonSchema>;

export const FoodAnalysisRecordSchema = z.object({
  // Identity
  imageHash: z.string(),
  imageByteLength: z.number(), // Salt for hash collision safety

  // Model metadata
  model: z.string(),
  promptVersion: z.string(),

  // Pass 1 (always present)
  pass1RawText: z.string(),
  pass1Parsed: VisionPassResultSchema,

  // Pass 2 (optional - only if triggered)
  pass2RawText: z.string().optional(),
  pass2Parsed: VisionPassResultSchema.optional(),

  // Final result
  status: AnalysisStatusSchema,
  divergenceReason: DivergenceReasonSchema,
  finalResult: VisionPassResultSchema,

  // Timestamps
  createdAt: z.date(),
  durationMs: z.number(),
});
export type FoodAnalysisRecord = z.infer<typeof FoodAnalysisRecordSchema>;

// =============================================================================
// Helper: Check if response is an error
// =============================================================================

export function isVisionError(
  response: VisionResponse,
): response is VisionError {
  return "error" in response && "errorType" in response;
}
