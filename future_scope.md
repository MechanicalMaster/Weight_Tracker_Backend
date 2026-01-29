# Future Scope: Deferred Deep Links

Deferred features for rate limiting, scheduled cleanup, iOS support, and analytics.

---

## Rate Limiting

### Option 1: Firebase App Check

Add device attestation to prevent abuse.

```typescript
// Enable App Check in your Firebase console
// Frontend: Initialize App Check with reCAPTCHA or device attestation
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("your-recaptcha-site-key"),
  isTokenAutoRefreshEnabled: true
});
```

Backend verification:
```typescript
import { getAppCheck } from "firebase-admin/app-check";

async function verifyAppCheck(req: Request) {
  const appCheckToken = req.headers["x-firebase-appcheck"];
  if (appCheckToken) {
    try {
      await getAppCheck().verifyToken(appCheckToken);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
```

### Option 2: IP-Based Throttling

Track IP hash on resolve and throttle > 30 requests/min per workflow.

```typescript
// Add to resolve workflow
const ipHash = crypto.createHash('sha256')
  .update(req.ip || '')
  .digest('hex')
  .substring(0, 16);

console.log(JSON.stringify({
  event: "workflow_resolved",
  workflowId,
  ipHash,
  timestamp: new Date().toISOString()
}));
```

### Option 3: Cloud Armor (GCP)

If publicly exposed, add Cloud Armor WAF rules for:
- Geographic restrictions
- Rate limiting by IP
- Bot protection

---

## Scheduled Expiry Cleanup

Run daily at 2 AM IST to clean up expired workflows:

```typescript
// functions/src/scheduled/workflowCleanup.ts
import * as functions from "firebase-functions/v2/scheduler";
import { db } from "../services/firestore";
import { Timestamp } from "firebase-admin/firestore";

export const cleanupExpiredWorkflows = functions.onSchedule(
  {
    schedule: "0 2 * * *",  // Daily at 2 AM
    timeZone: "Asia/Kolkata",
  },
  async () => {
    const now = Timestamp.now();
    const batch = db.batch();
    let count = 0;

    const expiredDocs = await db.collection("workflows")
      .where("status", "==", "ACTIVE")
      .where("expiresAt", "<", now)
      .limit(500)
      .get();

    expiredDocs.forEach((doc) => {
      batch.update(doc.ref, { status: "EXPIRED" });
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(JSON.stringify({
        event: "workflow_cleanup_completed",
        expiredCount: count,
        timestamp: now.toDate().toISOString()
      }));
    }
  }
);
```

---

## iOS Deferred Deep Linking

iOS App Store doesn't support install referrers. Alternatives:

### Option A: Fingerprinting (Not Recommended)

Match IP + User Agent between web click and app launch.
- Privacy concerns
- Low accuracy
- GDPR implications

### Option B: Clipboard-Based

1. Copy workflow ID to clipboard before redirect
2. App reads clipboard on first launch
3. Prompt user for permission (iOS 14+)

```swift
// After redirect, copy to clipboard
UIPasteboard.general.string = "WF_01HRX..."

// In app, after permission
if let workflowId = UIPasteboard.general.string,
   workflowId.hasPrefix("WF_") {
    resolveWorkflow(workflowId)
}
```

### Option C: Skip iOS (MVP)

Focus on Android. iOS users get normal install flow.

---

## Distributed Counters (High Traffic)

For campaigns exceeding 1 write/second per workflow:

```typescript
// Create sharded counter
const SHARD_COUNT = 10;

async function incrementResolveCount(workflowId: string) {
  const shardId = Math.floor(Math.random() * SHARD_COUNT);
  const shardRef = db.doc(`workflowStats/${workflowId}/shards/${shardId}`);
  
  await shardRef.set({
    count: FieldValue.increment(1)
  }, { merge: true });
}

async function getResolveCount(workflowId: string): Promise<number> {
  const shards = await db.collection(`workflowStats/${workflowId}/shards`).get();
  return shards.docs.reduce((total, doc) => total + (doc.data().count || 0), 0);
}
```

---

## BigQuery Analytics

Export workflow events for analytics:

1. Enable Firestore to BigQuery extension
2. Create materialized views for:
   - Campaign performance
   - Conversion rates
   - TTL optimization

```sql
-- Example: Campaign conversion rate
SELECT
  campaignId,
  COUNT(*) as total_created,
  COUNTIF(status = 'COMPLETED') as completed,
  COUNTIF(status = 'EXPIRED') as expired,
  SAFE_DIVIDE(COUNTIF(status = 'COMPLETED'), COUNT(*)) as conversion_rate
FROM `your_project.workflows`
GROUP BY campaignId
ORDER BY conversion_rate DESC
```
