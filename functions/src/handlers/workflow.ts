// Workflow handlers for deferred deep linking
import { Request, Response } from "express";
import { handleError, errors } from "../utils/errors";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";
import * as workflowService from "../services/workflow";
import { CreateWorkflowRequest, WORKFLOW_TYPES } from "../types/workflow";

/**
 * POST /workflows
 * Creates a new workflow for deferred deep linking
 *
 * Auth: Required
 * Body: CreateWorkflowRequest
 */
export async function createWorkflow(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    // Verify authentication
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (res.headersSent) return;

    // Note: Auth verified for rate limiting; uid unused for public workflows
    const body = req.body as CreateWorkflowRequest;

    // Validate required field
    if (!body.type) {
      throw errors.invalidRequest("type is required");
    }

    // Validate workflow type
    if (!WORKFLOW_TYPES.includes(body.type)) {
      throw errors.invalidRequest(
        `Invalid workflow type. Allowed: ${WORKFLOW_TYPES.join(", ")}`,
      );
    }

    // Create workflow
    const result = await workflowService.createWorkflow({
      type: body.type,
      payload: body.payload,
      expiresInHours: body.expiresInHours,
      campaignId: body.campaignId,
      maxResolves: body.maxResolves,
    });

    res.status(200).json({
      success: true,
      workflowId: result.workflowId,
      deepLinkUrl: result.deepLinkUrl,
    });
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * GET /workflows/:id
 * Resolves a workflow by ID
 *
 * Auth: Not required (public workflows)
 *
 * Note: Backend does NOT validate install source.
 * Install attribution is a frontend-only concern.
 * Resolution is allowed from any source by design.
 */
export async function resolveWorkflow(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const workflowId = req.params.id;

    if (!workflowId) {
      throw errors.invalidRequest("Workflow ID is required");
    }

    const result = await workflowService.resolveWorkflow(workflowId);

    res.status(200).json({
      success: true,
      type: result.type,
      status: result.status,
      payload: result.payload,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * POST /workflows/:id/complete
 * Marks a workflow as completed
 *
 * Auth: Not required (public workflows)
 *
 * Idempotent: Calling on already-completed workflow returns success.
 * State guard: Returns 409 if workflow is EXPIRED.
 */
export async function completeWorkflow(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    const workflowId = req.params.id;

    if (!workflowId) {
      throw errors.invalidRequest("Workflow ID is required");
    }

    const result = await workflowService.completeWorkflow(workflowId);

    res.status(200).json({
      success: true,
      status: result.status,
    });
  } catch (error) {
    handleError(error, res);
  }
}
