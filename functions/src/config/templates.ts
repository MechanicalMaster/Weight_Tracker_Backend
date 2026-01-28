import { PersonalizationContext } from "../services/user";

/**
 * Notification template structure.
 * Templates support variable interpolation using {{variableName}} syntax.
 */
export interface NotificationTemplate {
    id: string;
    title: string;
    body: string;
    link: string;
}

/**
 * Central template registry.
 * All notification templates are defined here for consistency and easy updates.
 */
export const TEMPLATES = {
  WEIGHT_REMINDER_V1: {
    id: "weight_reminder_v1",
    title: "Good {{timeOfDay}}, {{displayName}}! ⚖️",
    body: "Time to log your weight.",
    link: "platewise://entry",
  },
  BREAKFAST_V1: {
    id: "breakfast_v1",
    title: "Breakfast time, {{displayName}}! 🍳",
    body: "Had breakfast? Snap a quick photo",
    link: "platewise://food/capture",
  },
  LUNCH_V1: {
    id: "lunch_v1",
    title: "Lunch time, {{displayName}}! 🥗",
    body: "Capture what you're eating",
    link: "platewise://food/capture",
  },
  SNACKS_V1: {
    id: "snacks_v1",
    title: "Snack check, {{displayName}} 🍎",
    body: "Snacking? Log it to stay on track",
    link: "platewise://food/capture",
  },
  DINNER_V1: {
    id: "dinner_v1",
    title: "Dinner time, {{displayName}}! 🍽️",
    body: "Don't forget to log your meal",
    link: "platewise://food/capture",
  },
  EVENING_CHECKIN_V1: {
    id: "evening_checkin_v1",
    title: "Daily check-in, {{displayName}} 📊",
    body: "How was your day? Check your progress",
    link: "platewise://dashboard",
  },
} as const;

export type TemplateId = keyof typeof TEMPLATES;

/**
 * Renders a template by replacing placeholders with context values.
 *
 * Supported placeholders:
 * - {{displayName}} - User's display name or "Friend"
 * - {{timeOfDay}} - "morning", "afternoon", or "evening"
 * - {{timezone}} - User's timezone (rarely used in messages)
 *
 * @param template The notification template to render
 * @param context The personalization context with values for placeholders
 * @returns Rendered title and body
 */
export function renderTemplate(
  template: NotificationTemplate,
  context: PersonalizationContext,
): { title: string; body: string } {
  const replacePlaceholders = (text: string): string => {
    return text
      .replace(/\{\{displayName\}\}/g, context.displayName)
      .replace(/\{\{timeOfDay\}\}/g, context.timeOfDay)
      .replace(/\{\{timezone\}\}/g, context.timezone);
  };

  return {
    title: replacePlaceholders(template.title),
    body: replacePlaceholders(template.body),
  };
}

/**
 * Gets a template by its ID.
 * @param templateId The template identifier
 * @returns The template or undefined if not found
 */
export function getTemplate(templateId: TemplateId): NotificationTemplate {
  return TEMPLATES[templateId];
}
