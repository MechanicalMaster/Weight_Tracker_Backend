// Workflow service for deferred deep linking
import { db } from "./firestore";
import { ulid } from "ulid";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  WorkflowDocument,
  WorkflowStatus,
  WorkflowType,
  LogWeightPayload,
  WORKFLOW_ID_REGEX,
  WORKFLOW_TYPES,
  MIN_TTL_HOURS,
  MAX_TTL_HOURS,
  MIN_WEIGHT,
  MAX_WEIGHT,
} from "../types/workflow";
import { ApiError } from "../utils/errors";

// Deep link base URL (Vercel frontend)
const DEEP_LINK_BASE_URL = process.env.DEEP_LINK_BASE_URL ||
    "https://platewise.app";

// Collection reference
const workflowsCollection = db.collection("workflows");

// ============================================================================
// Structured Logging
// ============================================================================

interface WorkflowLogEvent {
    event: string;
    workflowId?: string;
    providedId?: string;
    type?: WorkflowType;
    status?: WorkflowStatus;
    campaignId?: string;
    expiresAt?: string;
    completedAt?: string;
    resolveCount?: number;
    currentStatus?: WorkflowStatus;
    reason?: string;
    timestamp: string;
}

function logWorkflowEvent(event: WorkflowLogEvent): void {
  console.log(JSON.stringify(event));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates workflow ID format (WF_{ULID})
 * Throws 400 if malformed to prevent Firestore injection
 */
export function validateWorkflowId(id: string): void {
  if (!WORKFLOW_ID_REGEX.test(id)) {
    logWorkflowEvent({
      event: "workflow_invalid_id",
      providedId: id,
      reason: "Malformed workflow ID format",
      timestamp: new Date().toISOString(),
    });
    throw new ApiError(400, "Invalid workflow ID format", "INVALID_WORKFLOW_ID");
  }
}

/**
 * Validates workflow type against allowed types
 */
export function validateWorkflowType(type: string): asserts type is WorkflowType {
  if (!WORKFLOW_TYPES.includes(type as WorkflowType)) {
    throw new ApiError(
      400,
      `Invalid workflow type. Allowed: ${WORKFLOW_TYPES.join(", ")}`,
      "INVALID_WORKFLOW_TYPE",
    );
  }
}

/**
 * Validates TTL is within bounds [MIN_TTL_HOURS, MAX_TTL_HOURS]
 */
export function validateTTL(hours: number): void {
  if (hours < MIN_TTL_HOURS || hours > MAX_TTL_HOURS) {
    throw new ApiError(
      400,
      `TTL must be between ${MIN_TTL_HOURS} and ${MAX_TTL_HOURS} hours`,
      "INVALID_TTL",
    );
  }
}

/**
 * Validates payload based on workflow type
 */
export function validatePayload(
  type: WorkflowType,
  payload: LogWeightPayload | undefined,
): LogWeightPayload {
  const validatedPayload: LogWeightPayload = { ...payload };

  if (type === "LOG_WEIGHT") {
    if (
      validatedPayload.suggestedWeight !== undefined &&
            (validatedPayload.suggestedWeight < MIN_WEIGHT ||
                validatedPayload.suggestedWeight > MAX_WEIGHT)
    ) {
      throw new ApiError(
        400,
        `suggestedWeight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT}`,
        "INVALID_PAYLOAD",
      );
    }
  }

  return validatedPayload;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Generates a new workflow ID with ULID
 */
function generateWorkflowId(): string {
  return `WF_${ulid()}`;
}

/**
 * Computes the effective status considering expiry
 * Does NOT mutate the document - expiry is computed, not persisted
 */
function computeStatus(workflow: WorkflowDocument): WorkflowStatus {
  if (workflow.status === "COMPLETED") {
    return "COMPLETED";
  }

  const now = Timestamp.now();
  if (workflow.expiresAt.toMillis() < now.toMillis()) {
    return "EXPIRED";
  }

  return "ACTIVE";
}

/**
 * Creates a new workflow
 */
export async function createWorkflow(params: {
    type: WorkflowType;
    payload?: LogWeightPayload;
    expiresInHours?: number;
    campaignId?: string;
    maxResolves?: number;
}): Promise<{ workflowId: string; deepLinkUrl: string }> {
  const {
    type,
    payload,
    expiresInHours = 48,
    campaignId,
    maxResolves,
  } = params;

  // Validate inputs
  validateWorkflowType(type);
  validateTTL(expiresInHours);
  const validatedPayload = validatePayload(type, payload);

  // Generate ID and timestamps
  const workflowId = generateWorkflowId();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() + expiresInHours * 60 * 60 * 1000,
  );

  // Create workflow document
  // userId is null for public workflows (current implementation)
  const workflowDoc: WorkflowDocument = {
    id: workflowId,
    type,
    status: "ACTIVE",
    payload: validatedPayload,
    userId: null, // Public workflows for now
    campaignId,
    createdAt: now,
    expiresAt,
    maxResolves,
    metadata: {
      clickCount: 0,
      resolveCount: 0,
    },
  };

  // Store in Firestore
  await workflowsCollection.doc(workflowId).set(workflowDoc);

  // Build deep link URL
  const deepLinkUrl = `${DEEP_LINK_BASE_URL}/wf/${workflowId}`;

  // Log creation
  logWorkflowEvent({
    event: "workflow_created",
    workflowId,
    type,
    campaignId,
    expiresAt: expiresAt.toDate().toISOString(),
    timestamp: new Date().toISOString(),
  });

  return { workflowId, deepLinkUrl };
}

/**
 * Resolves a workflow by ID
 * Returns computed status (EXPIRED if past TTL, without persisting)
 */
export async function resolveWorkflow(workflowId: string): Promise<{
    type: WorkflowType;
    status: WorkflowStatus;
    payload: LogWeightPayload;
    expiresAt: string;
}> {
  // Validate ID format
  validateWorkflowId(workflowId);

  // Fetch document
  const docRef = workflowsCollection.doc(workflowId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new ApiError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");
  }

  const workflow = docSnap.data() as WorkflowDocument;

  // Compute effective status (lazy expiry - no persistence)
  const computedStatus = computeStatus(workflow);

  // Increment resolve counter atomically
  await docRef.update({
    "metadata.resolveCount": FieldValue.increment(1),
    "metadata.lastResolvedAt": Timestamp.now(),
  });

  // Log based on status
  if (computedStatus === "EXPIRED") {
    logWorkflowEvent({
      event: "workflow_expired_access",
      workflowId,
      expiresAt: workflow.expiresAt.toDate().toISOString(),
      timestamp: new Date().toISOString(),
    });
  } else {
    logWorkflowEvent({
      event: "workflow_resolved",
      workflowId,
      status: computedStatus,
      resolveCount: (workflow.metadata.resolveCount || 0) + 1,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    type: workflow.type,
    status: computedStatus,
    payload: workflow.payload,
    expiresAt: workflow.expiresAt.toDate().toISOString(),
  };
}

/**
 * Completes a workflow (atomic transaction with state guard)
 *
 * State transitions allowed:
 * - ACTIVE → COMPLETED ✓
 *
 * State transitions forbidden:
 * - COMPLETED → ACTIVE ❌
 * - EXPIRED → ACTIVE ❌
 * - EXPIRED → COMPLETED ❌
 */
export async function completeWorkflow(
  workflowId: string,
): Promise<{ status: "COMPLETED" }> {
  // Validate ID format
  validateWorkflowId(workflowId);

  const docRef = workflowsCollection.doc(workflowId);

  await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists) {
      throw new ApiError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");
    }

    const workflow = docSnap.data() as WorkflowDocument;
    const computedStatus = computeStatus(workflow);

    // State guard: only ACTIVE workflows can be completed
    // Idempotent: if already COMPLETED, return success
    if (computedStatus === "COMPLETED") {
      logWorkflowEvent({
        event: "workflow_completed",
        workflowId,
        completedAt: workflow.completedAt?.toDate().toISOString() || "unknown",
        timestamp: new Date().toISOString(),
      });
      return; // Already completed, idempotent success
    }

    // Forbidden: cannot complete expired workflows
    if (computedStatus === "EXPIRED") {
      logWorkflowEvent({
        event: "workflow_illegal_transition",
        workflowId,
        currentStatus: "EXPIRED",
        timestamp: new Date().toISOString(),
      });
      throw new ApiError(
        409,
        "Cannot complete expired workflow",
        "WORKFLOW_EXPIRED",
      );
    }

    // Transition to COMPLETED
    const now = Timestamp.now();
    transaction.update(docRef, {
      status: "COMPLETED",
      completedAt: now,
    });

    logWorkflowEvent({
      event: "workflow_completed",
      workflowId,
      completedAt: now.toDate().toISOString(),
      timestamp: new Date().toISOString(),
    });
  });

  return { status: "COMPLETED" };
}
