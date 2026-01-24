This document outlines the technical execution plan for migrating the backend to an Event-Sourced Behavioral Architecture.

**Target Audience:** Backend Engineers, Mobile Engineers, Data Engineers.
**Objective:** Move from state-based snapshots to an append-only event stream with derived state caching, enforcing strict data quality and idempotency.

---

## 📅 Phased Rollout Schedule

| Phase | Focus | Key Deliverables |
| :--- | :--- | :--- |
| **1** | **Contracts & Core** | Zod schemas, Transactional Event Service, Types. |
| **2** | **API Implementation** | `POST /events` endpoint, Refactor `register-device`. |
| **3** | **Feature Integration** | Instrument Food Analysis, Push Notifications, Weight Logging. |
| **4** | **Client Integration** | Mobile update (UUIDs, Timezones, Session IDs). |
| **5** | **Data & Infra** | Backfill scripts, Firestore Indexes, BigQuery Sync. |

---

## Phase 1: Contracts & Core (Backend)

We establish the "Law" of the system before writing logic.

### 1.1 Create Behavioral Types Definition
**File:** `functions/src/types/behavioral.ts`
**Action:** Define strict Zod schemas and interfaces.

*   **Requirement:** Enforce `ROOT_SCHEMA_VERSION = 1` on all events.
*   **Requirement:** Define `EventName` as a strict TypeScript `enum`.
*   **Requirement:** Define `EventPayloads` mapping Zod schemas to Enum keys.
    *   *Crucial:* Add field `weight_value` (number) and `source` (manual/auto) to `WEIGHT_LOGGED`.
    *   *Crucial:* Add `timezone` to `DEVICE_REGISTERED`.

### 1.2 Implement Transactional Event Service
**File:** `functions/src/services/events.ts`
**Action:** Create `trackEventTx` function.

*   **Logic Flow (Must be inside `db.runTransaction`):**
    1.  **Idempotency Check:** Read `events/{eventId}`. If exists, return `{ status: 'duplicate' }`.
    2.  **Read User State:** Read `users/{userId}`.
    3.  **Compute Derived State:**
        *   If event is `WEIGHT_LOGGED`:
            *   Compare `event_local_date` vs `user.last_log_date`.
            *   If diff == 1 day, `streak++`.
            *   If diff > 1 day, `streak = 1`.
            *   If diff == 0, `streak` remains (no double counting).
    4.  **Prepare Writes:**
        *   `set` new Event document.
        *   `update` User document (`current_streak`, `last_log_date`, `last_active_at`, `total_logs`).
*   **Validation:** Use `EventPayloads[eventName].parse(metadata)` before opening transaction.

---

## Phase 2: API Layer Implementation

### 2.1 Create Generic Ingest Endpoint
**File:** `functions/src/handlers/events.ts`
**Endpoint:** `POST /events`
**Auth:** Required (`verifyAuth`).

**Request Body Schema (Zod):**
```typescript
{
  eventId: string;   // UUID v4 (Client generated)
  eventName: string; // Must match EventName enum
  timestamp: string; // ISO 8601
  timezone: string;  // IANA string (e.g., "America/New_York")
  sessionId: string; // Client generated UUID
  platform: "ios" | "android";
  metadata: object;  // Varies by eventName
}
```

**Implementation Details:**
*   Reject requests without valid `eventId`.
*   Pass full context to `trackEventTx`.
*   Return `200 OK` even if duplicate (idempotent success).

### 2.2 Refactor Device Registration
**File:** `functions/src/handlers/registerDevice.ts`

*   **Update Input:** Accept `timezone` in request body.
*   **Update Logic:**
    *   Keep existing `upsertDevice` logic (for legacy compatibility).
    *   **ADD:** Call `trackEventTx` with `DEVICE_REGISTERED`.
    *   *Note:* If user is anonymous, ensure `userId` is handled correctly (Auth UID).

---

## Phase 3: Feature Integration

### 3.1 Instrument Food Analysis
**File:** `functions/src/handlers/analyzeFoodImage.ts`

*   **Action:** After successful analysis, call `trackEventTx`.
*   **Event:** `FOOD_ANALYZED`.
*   **Metadata:**
    *   `success`: boolean
    *   `food_detected`: boolean
    *   `credits_remaining`: number
    *   `latency_ms`: number (calc start/end time)

### 3.2 Instrument Notification System
**File:** `functions/src/handlers/sendDailyNudge.ts`

*   **Refactor:** Stop writing to `nudges`. Write to `notifications` (new collection).
*   **Action:**
    1.  Generate `notification_id`.
    2.  Create Notification Document (Target: `WEIGHT_LOGGED`).
    3.  Send FCM.
    4.  **Log Event:** Call `trackEventTx` with `NOTIFICATION_DELIVERED` (or `FAILED`).
    *   *Note:* Do this async/parallel to avoid slowing down batch sending.

---

## Phase 4: Client-Side Requirements (Mobile Team)

**Deliverable:** Technical spec for Mobile Engineers.

### 4.1 Global Changes
1.  **UUID Generation:** Client must generate `uuid v4` for every single event.
2.  **Session Management:**
    *   Generate `sessionId` on App Launch.
    *   Persist in memory until App Kill or >30min background.
3.  **Timezone Detection:** Send `Intl.DateTimeFormat().resolvedOptions().timeZone` with every request.

### 4.2 Weight Log Screen
*   **Old Flow:** User clicks Save -> Call `/backup` (or direct firestore write).
*   **New Flow:**
    1.  User clicks Save.
    2.  Client Generates `eventId`.
    3.  Client calls `POST /events` with `{ eventName: "WEIGHT_LOGGED", metadata: { weight_value: 75.5 } ... }`.
    4.  Client awaits `200 OK`.
    5.  Client updates local UI state (optimistic update allowed).

---

## Phase 5: Data & Infrastructure

### 5.1 Firestore Indexes
**File:** `firestore.indexes.json`
**Action:** Add composite indexes for behavioral queries.

```json
{
  "collectionGroup": "events",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "user_id", "order": "ASCENDING" },
    { "fieldPath": "event_name", "order": "ASCENDING" },
    { "fieldPath": "event_timestamp_utc", "order": "DESCENDING" }
  ]
}
```

### 5.2 BigQuery Export (Crucial for Analytics)
**Action:** Install "Stream Firestore to BigQuery" Extension.
*   **Collection path:** `events`
*   **Table:** `raw_events`
*   **Partitioning:** By `timestamp` (Day).

### 5.3 One-Time Migration Script
**Task:** Backfill User State.
**Logic:**
1.  Iterate all `users`.
2.  Set default `timezone: 'UTC'`, `current_streak: 0`.
3.  (Optional) If you have historical data in `nudges` or `backups`, parse it to calculate a "best guess" streak and write to `users`.

---

## 🛑 Critical Engineering Guardrails

1.  **No Direct Writes:** The mobile client **MUST NOT** write to the `events` or `users` collection directly via Firestore SDK. All writes go through the Cloud Function API to guarantee the transaction logic.
2.  **Date Handling:**
    *   `event_timestamp_utc`: The moment the user pressed the button (Client Time).
    *   `ingested_at`: The moment the server processed it (Server Time).
    *   *Why?* To detect offline-mode syncing later.
3.  **Schema Evolution:** If `metadata` structure changes, increment `metadata_version`. Do not reuse version numbers for breaking changes.

## Definition of Done (DoD)

- [ ] `POST /events` returns 200 for valid payloads.
- [ ] `POST /events` returns 200 (not error) for duplicate `eventId`.
- [ ] `POST /events` returns 400 for invalid Schema (Zod).
- [ ] `users` document updates `current_streak` automatically when `WEIGHT_LOGGED` is sent.
- [ ] BigQuery is receiving rows from Firestore `events` collection.
- [ ] Mobile app is sending Timezone and Session ID.