# Plan: Behavioral Influence Engine (V3)

## Goal
Build a programmable motivation engine. Move from "Personalized Notifications" to a robust system that can inject behavioral context into any campaign.

## Core Architecture
**Pipeline**: `Campaign Intent` → `User Selection` → `Context Resolution` → `Rendering` → `Delivery`

## Detailed Implementation Steps

### 1. Data Layer: Context Resolution (`functions/src/services/user.ts`)
*   **Rename**: `resolvePersonalizationContext(uid: string)` (was `buildUserContext`)
*   **Robustness**: Ensure stability. Never throw on missing data.
    ```typescript
    return {
      displayName: safeString(user?.displayName, "Friend"),
      timezone: user?.timezone ?? "UTC", // Default to UTC
      // Future: daysSinceLastLog, currentStreak, etc.
    };
    ```

### 2. Logic Layer: Campaign Abstraction (`functions/src/campaigns/types.ts`)
*   **Interface**: Decouple campaign logic from handlers.
    ```typescript
    interface Campaign {
      id: string;
      templateId: string;
      // Returns devices that *should* receive this campaign
      selectEligibleDevices(): Promise<DeviceDocument[]>;
    }
    ```
*   **Implementation**: `DailyNudgeCampaign` implements this interface.

### 3. Infrastructure: Template Registry (`functions/src/config/templates.ts`)
*   **Definition**: Central template config.
    ```typescript
    export const TEMPLATES = {
      WEIGHT_REMINDER_V1: {
        id: "weight_reminder_v1",
        title: "Good morning, {{displayName}}! ⚖️",
        body: "Time to log your weight."
      }
    };
    ```

### 4. Operational Layer: Orchestration & Delivery (`functions/src/handlers/sendDailyNudge.ts`)
*   **Chunking Strategy**:
    *   **Selection**: Fetch all eligible devices.
    *   **Context Batching**: Process 500 UIDs at a time to build context (prevents memory spikes).
    *   **Delivery Batching**: `fcm.sendBatchNotifications` handles its own 500-device limit.
*   **Idempotency**:
    *   **Notification ID**: `${campaignId}_${activeDate}_${uid}`
    *   Example: `weight_reminder_v1_2024-03-20_user123`
    *   Prevents duplicate sends if the job retries.

### 5. Transport Layer: "Dumb" FCM (`functions/src/services/fcm.ts`)
*   **Responsibility**: Pure transport.
*   **Signature**: `sendBatchNotifications(payloads: PreparedNotification[])`

## Verification
1.  **Unit Tests**:
    *   `resolvePersonalizationContext`: Test with null user, empty fields, and valid data.
    *   `renderTemplate`: Test variable replacement.
2.  **Integration**: Run `DailyNudgeCampaign` selection logic to ensure it picks correct devices.
