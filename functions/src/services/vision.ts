import OpenAI from "openai";
import * as crypto from "crypto";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import {
  VisionPassResult,
  VisionPassResultSchema,
  VisionErrorSchema,
  FoodAnalysisRecord,
  NutritionData,
} from "../types";
import { VISION_CONFIG, COLLECTIONS } from "../config/constants";
import { errors } from "../utils/errors";
import { db, admin } from "./firestore";

// Define the API key as a Firebase parameter
const openaiApiKey = defineString("OPENAI_API_KEY");

// =============================================================================
// STRICT SYSTEM PROMPT - Multi-item with latent canonicalization
// =============================================================================

/* eslint-disable max-len */
const NUTRITION_PROMPT = `You are a precision food analysis system. Analyze the food image and return structured nutrition data.

RULES:
1. Detect up to 5 distinct food items in the image
2. For each item, estimate weight in grams and complete nutrition
3. Include latent canonical attributes for each item (internal classification)
4. Provide confidence score and visual cues that informed your estimate
5. All numeric values must be positive numbers, not strings

RESPONSE FORMAT (JSON only, no markdown):
{
  "items": [
    {
      "foodName": "string - specific name of food item",
      "estimatedWeight_g": number,
      "calories": number,
      "protein": number,
      "carbohydrates": number,
      "fat": number,
      "fiber": number,
      "_canonical": {
        "cuisine": "string - e.g. Indian, Italian, American",
        "baseIngredients": ["string array - main ingredients"],
        "cookingMethod": "string - e.g. grilled, fried, raw, steamed",
        "density": "low" | "medium" | "high",
        "moisture": "dry" | "moist" | "wet",
        "processingLevel": "raw" | "minimal" | "processed" | "ultra-processed"
      },
      "_debug": {
        "confidence": number between 0 and 1,
        "visualCues": ["string array - what you observed"]
      }
    }
  ],
  "totalWeight_g": number,
  "totalCalories": number
}

ERROR FORMAT (if analysis fails):
{
  "error": "description of issue",
  "errorType": "NOT_FOOD" | "BLURRY" | "LOW_CONFIDENCE" | "MULTIPLE_ITEMS"
}

Be conservative with calorie estimates. Base portion sizes on visible reference objects.`;
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
// Single Pass Execution
// =============================================================================

interface PassOutput {
  rawText: string;
  parsed: VisionPassResult;
}

async function runSinglePass(
  openai: OpenAI,
  imageBase64: string,
): Promise<PassOutput> {
  const response = await openai.chat.completions.create({
    model: VISION_CONFIG.MODEL,
    max_completion_tokens: VISION_CONFIG.MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: NUTRITION_PROMPT },
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

  const rawText = response.choices[0]?.message?.content;
  if (!rawText) {
    throw errors.aiServiceError();
  }

  const cleanContent = cleanJsonResponse(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleanContent);
  } catch {
    logger.error("Failed to parse vision response", { rawText });
    throw errors.parseError();
  }

  // Check for error response
  const errorResult = VisionErrorSchema.safeParse(parsed);
  if (errorResult.success) {
    handleAiError(errorResult.data.error, errorResult.data.errorType);
  }

  // Parse as success response
  const successResult = VisionPassResultSchema.safeParse(parsed);
  if (!successResult.success) {
    logger.error("Vision response validation failed", {
      errors: successResult.error.issues,
      rawText,
    });
    throw errors.parseError();
  }

  return { rawText, parsed: successResult.data };
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
// Main Entry Point
// =============================================================================

export async function analyzeFood(imageBase64: string): Promise<NutritionData> {
  const startTime = Date.now();
  const apiKey = openaiApiKey.value();

  if (!apiKey) {
    throw errors.aiConfigError();
  }

  const openai = new OpenAI({ apiKey });
  const { hash: imageHash, byteLength: imageByteLength } = computeImageHash(imageBase64);

  logger.info("Starting food image analysis", { imageHash });

  // Run single pass
  let passOutput: PassOutput;
  try {
    passOutput = await runSinglePass(openai, imageBase64);
  } catch (err) {
    logger.error("Analysis failed", { error: err });
    throw err;
  }

  logger.info("Analysis complete", {
    itemCount: passOutput.parsed.items.length,
    totalCalories: passOutput.parsed.totalCalories,
  });

  // Persist analysis record
  const record: FoodAnalysisRecord = {
    imageHash,
    imageByteLength,
    model: VISION_CONFIG.MODEL,
    promptVersion: VISION_CONFIG.PROMPT_VERSION,
    pass1RawText: passOutput.rawText,
    pass1Parsed: passOutput.parsed,
    status: "SINGLE_PASS",
    finalResult: passOutput.parsed,
    createdAt: new Date(),
    durationMs: Date.now() - startTime,
  };

  await persistAnalysis(record);

  // Aggregate to legacy format for backward compatibility
  return aggregateToLegacy(passOutput.parsed);
}
