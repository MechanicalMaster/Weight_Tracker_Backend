import OpenAI from "openai";
import { logger } from "firebase-functions/v2";
import { defineString } from "firebase-functions/params";
import { NutritionData } from "../types";
import { VISION_CONFIG } from "../config/constants";

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
  "error": "description of the issue"
}

Be reasonable with estimates based on typical serving sizes visible in the image.`;
/* eslint-enable max-len */

export async function analyzeFood(imageBase64: string): Promise<NutritionData> {
  const apiKey = openaiApiKey.value();

  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const openai = new OpenAI({ apiKey });

  logger.info("Starting food image analysis");

  const response = await openai.chat.completions.create({
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

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No response from vision model");
  }

  logger.info("Received response from vision model");

  // Parse the JSON response
  let parsed: NutritionData | { error: string };
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
    throw new Error("Failed to parse nutrition data from image");
  }

  // Check for error response
  if ("error" in parsed) {
    throw new Error(parsed.error);
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
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return parsed as NutritionData;
}
