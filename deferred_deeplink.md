Good. Now we stop philosophizing and write something you could hand to an engineer.

We’ll define a **backend technical specification** for:

> Workflow-driven deferred deep linking
> Using Firebase (Functions + Firestore)
> Frontend hosted on Vercel

No hand-waving. Concrete contracts.

---

# 1. System Overview

## Objective

Implement a server-authoritative workflow system that:

* Generates workflow IDs
* Resolves workflow state after install
* Enforces TTL and ownership
* Supports deferred deep linking
* Is idempotent
* Is auditable

All routing decisions are driven by backend state.

---

# 2. Data Model (Firestore)

## 2.1 Collection: `workflows`

**Path**

```
/workflows/{workflowId}
```

### Schema

```ts
interface Workflow {
  id: string                // WF_xxx (doc id)
  type: string              // LOG_WEIGHT | START_CHALLENGE | etc
  status: "ACTIVE" | "COMPLETED" | "EXPIRED"
  
  payload: {
    // Arbitrary JSON
    suggestedWeight?: number
    source?: string
  }

  userId: string | null     // null = public workflow
  campaignId?: string

  createdAt: Timestamp
  expiresAt: Timestamp

  completedAt?: Timestamp

  metadata: {
    clickCount: number
    resolveCount: number
    lastResolvedAt?: Timestamp
  }
}
```

---

## 2.2 Collection: `workflowClicks` (Optional but Recommended)

Used for attribution + debugging.

```
/workflowClicks/{clickId}
```

```ts
{
  workflowId: string
  createdAt: Timestamp
  ipHash: string
  userAgent: string
  installReferrerToken?: string
}
```

---

# 3. Workflow ID Format

Format:

```
WF_{ULID}
```

Use ULID (time-sortable unique ID) instead of random UUID.

Reason:

* Easier debugging
* Ordered by creation time
* Safer for analytics queries

---

# 4. Firebase Functions (HTTP + Callable)

All endpoints validate input strictly.

---

# 4.1 Create Workflow

### Endpoint

```
POST /api/workflows
```

### Auth

Required (Firebase Auth)

### Request

```json
{
  "type": "LOG_WEIGHT",
  "payload": {
    "suggestedWeight": 72.5
  },
  "expiresInHours": 48,
  "campaignId": "JAN_CAMPAIGN"
}
```

### Logic

1. Validate type against allowed enum.
2. Enforce max TTL (e.g., 72 hours).
3. Generate ULID.
4. Store workflow doc.
5. Return deep link URL.

### Response

```json
{
  "workflowId": "WF_01HRX...",
  "deepLinkUrl": "https://platewise.app/wf/WF_01HRX..."
}
```

---

# 4.2 Resolve Workflow

### Endpoint

```
GET /api/workflows/{workflowId}
```

### Auth

Optional (depends on workflow type)

### Logic

1. Fetch document.
2. If not found → 404.
3. If status = COMPLETED → return COMPLETED.
4. If expiresAt < now → mark EXPIRED, return EXPIRED.
5. If userId != null and user not authenticated → 401.
6. If userId != null and mismatch → 403.
7. Increment resolveCount.
8. Return workflow payload.

### Response

```json
{
  "type": "LOG_WEIGHT",
  "status": "ACTIVE",
  "payload": {
    "suggestedWeight": 72.5
  },
  "expiresAt": "2026-02-05T00:00:00Z"
}
```

---

# 4.3 Complete Workflow

### Endpoint

```
POST /api/workflows/{workflowId}/complete
```

### Auth

Required

### Logic

Atomic Firestore transaction:

1. Fetch workflow.
2. If status != ACTIVE → return idempotent success.
3. Update:

   * status = COMPLETED
   * completedAt = now
4. Commit.

### Response

```json
{
  "status": "COMPLETED"
}
```

Idempotent by design.

---

# 5. Deferred Deep Link Resolution (Android)

## Install Referrer Handling

Frontend retrieves:

```
workflow_id=WF_123
```

Frontend then calls:

```
GET /api/workflows/WF_123
```

Backend remains authoritative.

No special backend endpoint required.

---

# 6. Web Link Handling (Vercel)

You must create:

```
/wf/[workflowId]
```

### Behavior

Server-side:

1. Validate workflowId format.
2. Log click (optional).
3. Detect user-agent.
4. If Android:

   * Redirect to Play Store with referrer:

     ```
     referrer=workflow_id=WF_123
     ```
5. If iOS:

   * Redirect to App Store (no native referrer equivalent).
6. If desktop:

   * Show fallback page with QR.

---

# 7. Expiry Enforcement

Two layers:

## Lazy Expiry

When resolving, if expired:

* Mark EXPIRED
* Return EXPIRED

## Scheduled Cleanup (Optional)

Firebase Scheduled Function runs daily:

* Query workflows where:

  * status = ACTIVE
  * expiresAt < now
* Mark as EXPIRED

---

# 8. Retry Strategy (Backend)

Backend should be stateless.

Client handles retry logic.

However:

* Ensure GET /workflow is idempotent.
* No side effects except metadata counters.
* Counters should use atomic increment.

---

# 9. Security Rules (Firestore)

Block direct client writes.

Firestore Rules:

```js
match /workflows/{id} {
  allow read: if false;
  allow write: if false;
}
```

All operations must go through Functions.

---

# 10. Rate Limiting

Protect resolve endpoint.

Option 1:

* Firebase App Check

Option 2:

* Track IP + throttle > 30 requests/min per workflow

Prevents brute-force enumeration.

---

# 11. Observability

Log structured events:

* workflow_created
* workflow_resolved
* workflow_completed
* workflow_expired

Store in BigQuery or analytics system.

---

# 12. Failure Modes

## Case 1 — Workflow Not Found

Return 404.
Frontend shows generic fallback.

## Case 2 — Expired

Return EXPIRED.
Frontend navigates to home.

## Case 3 — Already Completed

Return COMPLETED.
Frontend navigates to trends.

---

# 13. Idempotency Rules

* Resolve = safe
* Complete = transactional
* Duplicate complete calls = safe
* Expiry auto-update = safe

System must tolerate:

* Multiple app launches
* Network retries
* Double clicks
* App restarts

---

# 14. Non-Goals

Backend does NOT:

* Navigate screens
* Trust install referrer blindly
* Auto-complete workflows
* Store sensitive client state

---

# 15. Minimal Deployment Stack

Firebase:

* Firestore
* Cloud Functions (HTTP)
* Scheduled Functions
* App Check

Vercel:

* Next.js route handler for `/wf/[workflowId]`

---

# What You Now Have

Not “deferred deep link.”

You have:

A deterministic workflow execution backend with:

* TTL
* Ownership
* Idempotency
* State transitions
* Attribution hooks
* Platform-agnostic resolution

When you later move to fintech, you change:

```
type = LOG_WEIGHT
```

to

```
type = BBPS_PAYMENT
```

And the backend shape barely changes.

That’s the point.

Architecture is reusable when it’s state-driven, not screen-driven.

If you want, next we can define the exact Next.js Vercel handler spec and Android install referrer parsing spec in similar detail.
