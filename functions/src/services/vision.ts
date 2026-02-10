import OpenAI from "openai";
import * as crypto from "crypto";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import {
  VisionPassResult,
  VisionErrorSchema,
  FoodAnalysisRecord,
  NutritionData,
  PerceptionResult,
  PerceptionResultSchema,
  NutritionResult,
  NutritionResultSchema,
  PerceptionItem,
} from "../types";
import { VISION_CONFIG, COLLECTIONS } from "../config/constants";
import { errors } from "../utils/errors";
import { db, admin } from "./firestore";
import { uploadFoodImage } from "./imageStorage";

/**
 * Metadata passed from handlers for eval tracking.
 */
export interface AnalysisMetadata {
  uid: string;
  mimeType: string;
}

// Define the API key as a Firebase parameter
const openaiApiKey = defineString("OPENAI_API_KEY");

// =============================================================================
// 2-STAGE PROMPTS
// =============================================================================

/* eslint-disable max-len */

/**
 * Stage 1: Vision Perception
 * Only what requires pixels. Nothing else.
 */
const PERCEPTION_PROMPT = `You are a food perception system.

Task:
From the image, identify up to 5 distinct food items and estimate their
approximate edible weight in grams.

Rules:
- Focus on visual identification only.
- Be conservative with weight estimates.
- Do NOT estimate nutrition.
- Do NOT explain reasoning.
- Do NOT infer ingredients or cooking method.
- Output JSON only.

Response format:
{
  "items": [
    {
      "foodName": "string",
      "estimatedWeight_g": number,
      "confidence": number between 0 and 1
    }
  ]
}

Error format:
{
  "error": "description",
  "errorType": "NOT_FOOD" | "BLURRY" | "LOW_CONFIDENCE" | "MULTIPLE_ITEMS"
}`;

/**
 * Stage 2: Nutrition Reasoning (Text-only)
 * Statistical nutrition estimation from identified items.
 */
const NUTRITION_PROMPT = `You are a nutrition estimation system.

Given the following food items and their estimated weights,
estimate typical home-style nutrition values.

Rules:
- Use typical preparation assumptions.
- Be conservative.
- No explanations.
- Output JSON only.

Response format:
{
  "items": [
    {
      "foodName": "string",
      "calories": number,
      "protein": number,
      "carbohydrates": number,
      "fat": number,
      "fiber": number
    }
  ]
}`;

/* eslint-enable max-len */

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute SHA-256 hash of image with byte length salt for collision safety
 */
function computeImageHash(imageBase64: string): { hash: string; byteLength: number } {
  const buffer = Buffer.from(imageBase64, "base64");
  const byteLength = buffer.length;
  const saltedInput = `${imageBase64}:${byteLength}`;
  const hash = crypto.createHash("sha256").update(saltedInput).digest("hex");
  return { hash, byteLength };
}

/**
 * Clean markdown code blocks from LLM response
 */
function cleanJsonResponse(content: string): string {
  let clean = content.trim();
  if (clean.startsWith("```json")) {
    clean = clean.slice(7);
  }
  if (clean.startsWith("```")) {
    clean = clean.slice(3);
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3);
  }
  return clean.trim();
}

/**
 * Normalize food name between stages
 * - lowercase
 * - trim
 * - basic plural handling
 */
function normalizeFoodName(name: string): string {
  let normalized = name.toLowerCase().trim();
  // Simple plural normalization
  if (normalized.endsWith("ies") && normalized.length > 4) {
    normalized = normalized.slice(0, -3) + "y";
  } else if (normalized.endsWith("es") && normalized.length > 3) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("s") && normalized.length > 2) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

// =============================================================================
// Error Handling
// =============================================================================

function handleAiError(errorMessage: string, errorType?: string): never {
  const lowerMessage = errorMessage.toLowerCase();

  if (errorType) {
    switch (errorType) {
    case "NOT_FOOD":
      throw errors.notFood(errorMessage);
    case "BLURRY":
      throw errors.imageTooBlurry();
    case "MULTIPLE_ITEMS":
      throw errors.multipleFoods();
    case "LOW_CONFIDENCE":
      throw errors.lowConfidence();
    default:
      throw errors.analysisFailed(errorMessage);
    }
  }

  if (lowerMessage.includes("not food") || lowerMessage.includes("no food")) {
    throw errors.notFood(errorMessage);
  }
  if (lowerMessage.includes("blurry") || lowerMessage.includes("unclear")) {
    throw errors.imageTooBlurry();
  }
  if (lowerMessage.includes("cannot identify") || lowerMessage.includes("not sure")) {
    throw errors.lowConfidence();
  }

  throw errors.analysisFailed(errorMessage);
}

// =============================================================================
// Stage 1: Vision Perception
// =============================================================================

interface PerceptionOutput {
  rawText: string;
  parsed: PerceptionResult;
  durationMs: number;
}

/**
 * Stage 1: Identify food items and estimate weights from image.
 * Uses vision model with tight token limit.
 */
async function runVisionPerception(
  openai: OpenAI,
  imageBase64: string,
): Promise<PerceptionOutput> {
  const startTime = Date.now();

  const response = await openai.chat.completions.create({
    model: VISION_CONFIG.MODEL,
    max_completion_tokens: VISION_CONFIG.PERCEPTION_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PERCEPTION_PROMPT },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: "low",
            },
          },
        ],
      },
    ],
  });

  const durationMs = Date.now() - startTime;
  const rawText = response.choices[0]?.message?.content;

  if (!rawText) {
    throw errors.aiServiceError();
  }

  const cleanContent = cleanJsonResponse(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleanContent);
  } catch {
    logger.error("Failed to parse perception response", { rawText });
    throw errors.parseError();
  }

  // Check for error response
  const errorResult = VisionErrorSchema.safeParse(parsed);
  if (errorResult.success) {
    handleAiError(errorResult.data.error, errorResult.data.errorType);
  }

  // Parse as perception result
  const successResult = PerceptionResultSchema.safeParse(parsed);
  if (!successResult.success) {
    logger.error("Perception response validation failed", {
      errors: successResult.error.issues,
      rawText,
    });
    throw errors.parseError();
  }

  logger.info("Stage 1 (Perception) complete", {
    itemCount: successResult.data.items.length,
    durationMs,
  });

  return { rawText, parsed: successResult.data, durationMs };
}

// =============================================================================
// Stage 2: Nutrition Reasoning (Text-only)
// =============================================================================

interface NutritionOutput {
  rawText: string;
  parsed: NutritionResult;
  durationMs: number;
}

/**
 * Stage 2: Estimate nutrition from identified food items.
 * Text-only model call - no image context.
 */
async function runNutritionText(
  openai: OpenAI,
  items: PerceptionItem[],
): Promise<NutritionOutput> {
  const startTime = Date.now();

  // Prepare input with normalized food names
  const input = items.map((item) => ({
    foodName: item.foodName,
    estimatedWeight_g: item.estimatedWeight_g,
  }));

  const response = await openai.chat.completions.create({
    model: VISION_CONFIG.TEXT_MODEL, // Explicitly mark as text-only
    max_completion_tokens: VISION_CONFIG.NUTRITION_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: `${NUTRITION_PROMPT}\n\nInput:\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });

  const durationMs = Date.now() - startTime;
  const rawText = response.choices[0]?.message?.content;

  if (!rawText) {
    throw errors.aiServiceError();
  }

  const cleanContent = cleanJsonResponse(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleanContent);
  } catch {
    logger.error("Failed to parse nutrition response", { rawText });
    throw errors.parseError();
  }

  // Parse as nutrition result
  const successResult = NutritionResultSchema.safeParse(parsed);
  if (!successResult.success) {
    logger.error("Nutrition response validation failed", {
      errors: successResult.error.issues,
      rawText,
    });
    throw errors.parseError();
  }

  logger.info("Stage 2 (Nutrition) complete", {
    itemCount: successResult.data.items.length,
    durationMs,
  });

  return { rawText, parsed: successResult.data, durationMs };
}

// =============================================================================
// Confidence Gating
// =============================================================================

/**
 * Gate Stage 2 execution based on perception confidence.
 * Throws LOW_CONFIDENCE if any item is below threshold.
 */
function validatePerceptionConfidence(items: PerceptionItem[]): void {
  const minConfidence = Math.min(...items.map((i) => i.confidence));

  if (minConfidence < VISION_CONFIG.MIN_CONFIDENCE) {
    logger.warn("Perception confidence too low, aborting Stage 2", {
      minConfidence,
      threshold: VISION_CONFIG.MIN_CONFIDENCE,
    });
    throw errors.lowConfidence();
  }
}

// =============================================================================
// Merge Results to VisionPassResult (backward compatibility)
// =============================================================================

/**
 * Merge perception and nutrition outputs into VisionPassResult format.
 * This maintains backward compatibility with existing persistence and aggregation.
 */
function mergeToVisionPassResult(
  perception: PerceptionResult,
  nutrition: NutritionResult,
): VisionPassResult {
  // Create a map of normalized food names to nutrition data
  const nutritionMap = new Map<string, NutritionResult["items"][0]>();
  for (const item of nutrition.items) {
    nutritionMap.set(normalizeFoodName(item.foodName), item);
  }

  // Merge perception items with nutrition data
  const items = perception.items.map((pItem) => {
    const normalizedName = normalizeFoodName(pItem.foodName);
    const nItem = nutritionMap.get(normalizedName);

    // Default nutrition if not found (shouldn't happen but be safe)
    const calories = nItem?.calories ?? 0;
    const protein = nItem?.protein ?? 0;
    const carbohydrates = nItem?.carbohydrates ?? 0;
    const fat = nItem?.fat ?? 0;
    const fiber = nItem?.fiber ?? 0;

    return {
      foodName: pItem.foodName,
      estimatedWeight_g: pItem.estimatedWeight_g,
      calories,
      protein,
      carbohydrates,
      fat,
      fiber,
      // Placeholder canonical data (not used in 2-stage mode)
      _canonical: {
        cuisine: "unknown",
        baseIngredients: [],
        cookingMethod: "unknown",
        density: "medium" as const,
        moisture: "moist" as const,
        processingLevel: "minimal" as const,
      },
      _debug: {
        confidence: pItem.confidence,
        visualCues: [],
      },
    };
  });

  const totalWeight = items.reduce((sum, i) => sum + i.estimatedWeight_g, 0);
  const totalCalories = items.reduce((sum, i) => sum + i.calories, 0);

  return {
    items,
    totalWeight_g: totalWeight,
    totalCalories,
  };
}

// =============================================================================
// Persistence
// =============================================================================

async function persistAnalysis(record: FoodAnalysisRecord): Promise<void> {
  try {
    await db.collection(COLLECTIONS.FOOD_ANALYSES).add({
      ...record,
      createdAt: admin.firestore.Timestamp.fromDate(record.createdAt),
    });
    logger.info("Persisted food analysis", {
      imageHash: record.imageHash,
      status: record.status,
      itemCount: record.finalResult.items.length,
    });
  } catch (err) {
    logger.error("Failed to persist food analysis", { error: err });
    // Don't throw - persistence failure shouldn't block response
  }
}

// =============================================================================
// Legacy Aggregation (Backward Compatibility)
// =============================================================================

function aggregateToLegacy(result: VisionPassResult): NutritionData {
  const totalProtein = result.items.reduce((sum, i) => sum + i.protein, 0);
  const totalCarbs = result.items.reduce((sum, i) => sum + i.carbohydrates, 0);
  const totalFat = result.items.reduce((sum, i) => sum + i.fat, 0);
  const totalFiber = result.items.reduce((sum, i) => sum + i.fiber, 0);

  const foodName = result.items.length === 1 ?
    result.items[0].foodName :
    "Mixed meal";

  return {
    foodName,
    calories: result.totalCalories,
    protein: Math.round(totalProtein * 10) / 10,
    carbohydrates: Math.round(totalCarbs * 10) / 10,
    fat: Math.round(totalFat * 10) / 10,
    fiber: Math.round(totalFiber * 10) / 10,
    estimatedServingSize: `${result.totalWeight_g}g`,
  };
}

// =============================================================================
// Main Entry Point: 2-Stage Pipeline
// =============================================================================

export async function analyzeFood(
  imageBase64: string,
  metadata?: AnalysisMetadata,
): Promise<NutritionData> {
  const startTime = Date.now();
  const apiKey = openaiApiKey.value();

  if (!apiKey) {
    throw errors.aiConfigError();
  }

  const openai = new OpenAI({ apiKey });
  const { hash: imageHash, byteLength: imageByteLength } = computeImageHash(imageBase64);

  logger.info("Starting 2-stage food analysis", { imageHash });

  // ==========================================================================
  // Upload raw image to Cloud Storage (fire-and-forget, parallel with Stage 1)
  // ==========================================================================
  let imageUploadPromise: Promise<string | undefined> = Promise.resolve(undefined);
  if (metadata) {
    imageUploadPromise = uploadFoodImage(
      imageBase64,
      metadata.uid,
      imageHash,
      metadata.mimeType,
    );
  }

  // ==========================================================================
  // Stage 1: Vision Perception
  // ==========================================================================
  let perception: PerceptionOutput;
  try {
    perception = await runVisionPerception(openai, imageBase64);
  } catch (err) {
    logger.error("Stage 1 (Perception) failed", { error: err });
    throw err;
  }

  // ==========================================================================
  // Confidence Gate
  // ==========================================================================
  validatePerceptionConfidence(perception.parsed.items);

  // ==========================================================================
  // Stage 2: Nutrition Reasoning (Text-only)
  // ==========================================================================
  let nutrition: NutritionOutput;
  try {
    nutrition = await runNutritionText(openai, perception.parsed.items);
  } catch (err) {
    logger.error("Stage 2 (Nutrition) failed", { error: err });
    throw err;
  }

  // ==========================================================================
  // Merge Results
  // ==========================================================================
  const finalResult = mergeToVisionPassResult(perception.parsed, nutrition.parsed);
  const totalDurationMs = Date.now() - startTime;

  logger.info("2-stage analysis complete", {
    itemCount: finalResult.items.length,
    totalCalories: finalResult.totalCalories,
    perceptionMs: perception.durationMs,
    nutritionMs: nutrition.durationMs,
    totalMs: totalDurationMs,
  });

  // Await image upload (should be done by now, ran in parallel with Stage 1+2)
  const imageStorageUrl = await imageUploadPromise;

  // ==========================================================================
  // Persist Analysis Record
  // ==========================================================================
  const record: FoodAnalysisRecord = {
    imageHash,
    imageByteLength,
    model: VISION_CONFIG.MODEL,
    promptVersion: VISION_CONFIG.PROMPT_VERSION,

    // Eval metadata
    imageStorageUrl: imageStorageUrl || undefined,
    userId: metadata?.uid,
    mimeType: metadata?.mimeType,
    source: "full_analysis",
    promptPerception: PERCEPTION_PROMPT,
    promptNutrition: NUTRITION_PROMPT,

    // Stage 1: Perception
    perceptionRawText: perception.rawText,
    perceptionParsed: perception.parsed,
    perceptionDurationMs: perception.durationMs,

    // Stage 2: Nutrition
    nutritionRawText: nutrition.rawText,
    nutritionParsed: nutrition.parsed,
    nutritionDurationMs: nutrition.durationMs,

    // Final result
    status: "TWO_STAGE",
    finalResult,
    createdAt: new Date(),
    durationMs: totalDurationMs,
  };

  await persistAnalysis(record);

  // Aggregate to legacy format for backward compatibility
  return aggregateToLegacy(finalResult);
}

// =============================================================================
// Quick Scan: Single-Stage Lightweight Analysis
// =============================================================================

const DAILY_CALORIE_TARGET = 2000;
const AVG_KCAL_PER_GRAM = 1.5; // Conservative average for mixed foods

/**
 * Map numeric confidence to categorical level
 */
function mapConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * Generate one-liner message about calorie percentage
 */
function generateCalorieMessage(calories: number): string {
  const percentage = Math.round((calories / DAILY_CALORIE_TARGET) * 100);
  return `That's ${percentage}% of a typical daily target`;
}

/**
 * Quick food scan - lightweight single-stage analysis
 * Returns simplified results: food name, confidence, estimated calories, one-liner
 *
 * Uses only Stage 1 (perception) for speed.
 * Does NOT persist to Firestore.
 */
export async function quickAnalyzeFood(
  imageBase64: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _metadata?: AnalysisMetadata,
): Promise<{
  foodName: string;
  confidence: "high" | "medium" | "low";
  calories: number;
  message: string;
}> {
  const startTime = Date.now();
  const apiKey = openaiApiKey.value();

  if (!apiKey) {
    throw errors.aiConfigError();
  }

  const openai = new OpenAI({ apiKey });
  const { hash: imageHash } = computeImageHash(imageBase64);

  logger.info("Starting quick food scan", { imageHash });

  // Run Stage 1 only (perception)
  const perception = await runVisionPerception(openai, imageBase64);

  // Aggregate items if multiple detected
  const items = perception.parsed.items;
  const totalWeight = items.reduce((sum, i) => sum + i.estimatedWeight_g, 0);
  const avgConfidence = items.reduce((sum, i) => sum + i.confidence, 0) / items.length;

  // Generate food name
  const foodName = items.length === 1 ?
    items[0].foodName :
    items.map((i) => i.foodName).join(" + ");

  // Rough calorie estimate based on weight
  const calories = Math.round(totalWeight * AVG_KCAL_PER_GRAM);

  const durationMs = Date.now() - startTime;

  logger.info("Quick scan complete", {
    foodName,
    calories,
    confidence: mapConfidenceLevel(avgConfidence),
    durationMs,
  });

  return {
    foodName,
    confidence: mapConfidenceLevel(avgConfidence),
    calories,
    message: generateCalorieMessage(calories),
  };
}
