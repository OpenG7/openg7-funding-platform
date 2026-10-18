import { registerMediaWorkspaceAnalysisTests } from './media-review-workspace/analysis-scenarios.js';
import { registerMediaWorkspaceDecisionTests } from './media-review-workspace/decision-scenarios.js';
import type { MediaWorkspaceTestContext } from './media-review-workspace/fixture.js';

/** Preserve the registration entry used by the admin sponsorship browser suite. */
export function registerMediaReviewWorkspaceTests(
  context: MediaWorkspaceTestContext
): void {
  registerMediaWorkspaceDecisionTests(context);
  registerMediaWorkspaceAnalysisTests(context);
}
