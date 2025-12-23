import OpenAI from "openai";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import { NutritionData } from "../types";
import { VISION_CONFIG } from "../config/constants";
import { errors } from "../utils/errors";

// Define the API key as a Firebase parameter (set via firebase functions:config or secrets)
const openaiApiKey = defineString("OPENAI_API_KEY");

/* eslint-disable max-len */
const NUTRITION_PROMPT = `You are a nutrition analysis expert. Analyze the food in this image and provide nutritional information.

IMPORTANT: Respond ONLY with valid JSON in this exact format, no additional text:
{
  "foodName": "name of the food/dish",
  "calories": number (estimated calories),
  "protein": number (grams),
  "carbohydrates": number (grams),
  "fat": number (grams),
  "fiber": number (grams),
  "estimatedServingSize": "description of serving size"
}

If you cannot identify the food or the image doesn't contain food, respond with:
{
  "error": "description of the issue",
  "errorType": "NOT_FOOD" | "BLURRY" | "MULTIPLE_ITEMS" | "LOW_CONFIDENCE" | "OTHER"
}

Be reasonable with estimates based on typical serving sizes visible in the image.`;
/* eslint-enable max-len */

/**
 * Maps AI error types to our ApiError factories
 */
function handleAiError(errorMessage: string, errorType?: string): never {
  const lowerMessage = errorMessage.toLowerCase();

  // Check explicit errorType first
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

  // Fallback: detect from message content
  if (
    lowerMessage.includes("not food") ||
    lowerMessage.includes("no food") ||
    lowerMessage.includes("doesn't contain food") ||
    lowerMessage.includes("does not contain food") ||
    lowerMessage.includes("not a food")
  ) {
    throw errors.notFood(errorMessage);
  }

  if (
    lowerMessage.includes("blurry") ||
    lowerMessage.includes("unclear") ||
    lowerMessage.includes("out of focus")
  ) {
    throw errors.imageTooBlurry();
  }

  if (
    lowerMessage.includes("multiple") ||
    lowerMessage.includes("several items")
  ) {
    throw errors.multipleFoods();
  }

  if (
    lowerMessage.includes("cannot identify") ||
    lowerMessage.includes("unable to identify") ||
    lowerMessage.includes("not sure") ||
    lowerMessage.includes("unclear what")
  ) {
    throw errors.lowConfidence();
  }

  // Generic fallback
  throw errors.analysisFailed(errorMessage);
}

export async function analyzeFood(imageBase64: string): Promise<NutritionData> {
  const apiKey = openaiApiKey.value();

  if (!apiKey) {
    throw errors.aiConfigError();
  }

  const openai = new OpenAI({ apiKey });

  logger.info("Starting food image analysis");

  let response;
  try {
    response = await openai.chat.completions.create({
      model: VISION_CONFIG.MODEL,
      max_tokens: VISION_CONFIG.MAX_TOKENS,
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
  } catch (err) {
    logger.error("OpenAI API error", { error: err });
    throw errors.aiServiceError();
  }

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw errors.aiServiceError();
  }

  logger.info("Received response from vision model");

  // Parse the JSON response
  let parsed: NutritionData | { error: string; errorType?: string };
  try {
    // Clean up the response - remove markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith("```json")) {
      cleanContent = cleanContent.slice(7);
    }
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.slice(3);
    }
    if (cleanContent.endsWith("```")) {
      cleanContent = cleanContent.slice(0, -3);
    }
    parsed = JSON.parse(cleanContent.trim());
  } catch {
    logger.error("Failed to parse vision response", { content });
    throw errors.parseError();
  }

  // Check for error response from AI
  if ("error" in parsed) {
    handleAiError(
      parsed.error,
      "errorType" in parsed ? parsed.errorType : undefined,
    );
  }

  // Validate the response has all required fields
  const required = [
    "foodName",
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "fiber",
    "estimatedServingSize",
  ];
  for (const field of required) {
    if (!(field in parsed)) {
      throw errors.parseError();
    }
  }

  return parsed as NutritionData;
}

