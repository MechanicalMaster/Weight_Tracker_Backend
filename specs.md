
### 2. The Missing Link: Connecting Auth to Push Notifications

Currently, your `register-device` endpoint is **public** and **unaware** of the user. We need to lock the `deviceId` to the `uid`.

Here is the plan to unify them:

1.  **Secure the Endpoint:** Make `/register-device` require a Firebase Token.
2.  **Store the Link:** Save the `uid` inside the `devices` collection.

#### Step 1: Update `functions/src/services/firestore.ts`

We need to update the `upsertDevice` function to accept and store the `uid`.

```typescript
// functions/src/services/firestore.ts

import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v2";
import { COLLECTIONS, LIMITS } from "../config/constants";
import { DeviceDocument, NudgeDocument } from "../types";

// ... existing init code ...

const db = admin.firestore();

// Update interface (Optional: add to types/index.ts as well)
export interface DeviceDocument {
  deviceId: string;
  uid: string; // <--- NEW FIELD
  fcmToken: string;
  platform: "ios" | "android";
  createdAt: FirebaseFirestore.Timestamp;
  lastSeenAt: FirebaseFirestore.Timestamp;
}

// Updated upsert function
export async function upsertDevice(
  uid: string, // <--- NEW PARAM
  deviceId: string,
  fcmToken: string,
  platform: "ios" | "android",
): Promise<void> {
  const deviceRef = db.collection(COLLECTIONS.DEVICES).doc(deviceId);
  const now = admin.firestore.Timestamp.now();

  const deviceDoc = await deviceRef.get();

  if (deviceDoc.exists) {
    // Update existing device
    // We update the UID to ensure the device is 'claimed' by the current logged-in user
    await deviceRef.update({
      uid, 
      fcmToken,
      platform,
      lastSeenAt: now,
    });
    logger.info(`Updated device: ${deviceId} for user: ${uid}`);
  } else {
    // Create new device
    const newDevice: DeviceDocument = {
      deviceId,
      uid,
      fcmToken,
      platform,
      createdAt: now,
      lastSeenAt: now,
    };
    await deviceRef.set(newDevice);
    logger.info(`Registered new device: ${deviceId} for user: ${uid}`);
  }
}

// ... rest of the file ...
```

#### Step 2: Update `functions/src/handlers/registerDevice.ts`

Now we secure the handler so it extracts the `uid` from the token.

```typescript
// functions/src/handlers/registerDevice.ts

import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { upsertDevice } from "../services/firestore";
import { trackEventAsync } from "../services/events";
import { deviceRegistrationSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { EventName } from "../types/behavioral";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth"; // Import Auth

export async function registerDevice(
  req: Request & AuthenticatedRequest, // Add AuthenticatedRequest type
  res: Response
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    // 1. VERIFY AUTH
    // This connects the request to the Firebase User (Anonymous or Gmail)
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (res.headersSent) return;

    const uid = req.uid!; // Securely obtained from token

    // 2. Validate input
    const validation = validateInput(deviceRegistrationSchema, req.body);
    if (!validation.success) {
      throw errors.invalidRequest(validation.error);
    }

    const { deviceId, fcmToken, platform, timezone } = validation.data;

    logger.info(`Registering device: ${deviceId} to User: ${uid}`);

    // 3. Upsert with UID
    await upsertDevice(uid, deviceId, fcmToken, platform);

    // 4. Track Event (Now properly attributed to the UID)
    if (timezone) {
      trackEventAsync({
        eventName: EventName.DEVICE_REGISTERED,
        userId: uid, // Use actual UID now, not deviceId
        timestamp: new Date().toISOString(),
        timezone,
        platform,
        metadata: {
          timezone,
          platform,
          deviceId // Keep deviceId in metadata for reference
        },
      }).catch((err) => {
        logger.warn("Failed to track device registration event", { error: err });
      });
    }

    res.status(200).json({
      success: true,
      message: "Device registered successfully",
    });
  } catch (error) {
    handleError(error, res);
  }
}
```

### 3. How the User Journey flows now

1.  **App Launch (Fresh Install):**
    *   Client SDK: `auth().signInAnonymously()` -> Returns `User A`.
    *   Client: Calls `POST /register-device` with Token A.
    *   **Backend:** Locks Device ID `D1` to User `A`.

2.  **Daily Nudge:**
    *   Scheduler runs. It grabs `D1` from the database.
    *   Sends Push Notification.
    *   It works because the device token is fresh.

3.  **User Links Gmail (Optional):**
    *   Client SDK: `user.linkWithCredential(googleCred)`.
    *   User is still `User A`, but now has an email attached.
    *   Client: Calls `POST /register-device` again (on next launch or immediately).
    *   **Backend:** Updates `D1` -> `User A`. (No change in ID, just refreshed token).

4.  **Reinstall (Android - The Danger Zone):**
    *   User deletes app. `User A` is wiped from phone.
    *   User reinstalls. `auth().signInAnonymously()` -> Returns **`User B`** (New ID).
    *   Client: Calls `POST /register-device`.
    *   **Backend:** Updates `D1` -> **`User B`**.
    *   *Result:* The device is now owned by the new empty account. The old history is "orphaned" in `User A`.
    *   *Recovery:* User clicks "Sign in with Google". Client SDK detects `User A` exists. Logs in as `User A`.
    *   Client: Calls `POST /register-device`.
    *   **Backend:** Updates `D1` -> **`User A`**. History restored.
