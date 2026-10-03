import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpensesResponse,
  AdminExpenseStatus,
  AdminExpenseUpdateRequest,
  AdminTransparencyResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import {
  allocationAmountMinor,
  isPublicAllocationProofUrl
} from '../../../packages/funding-core/src/index.js';

import type { AdminExpenseAuditInput } from './fund-admin.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

const ADMIN_EXPENSE_NAME_MAX_LENGTH = 160;
const ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH = 1000;
const allowedFundAchievementProgressStatuses = new Set([
  'planned',
  'in_progress',
  'delivered'
]);

const isAllowedFundAchievementProgressStatus = (
  value: unknown
): value is 'planned' | 'in_progress' | 'delivered' =>
  typeof value === 'string' &&
  allowedFundAchievementProgressStatuses.has(value);

const isValidAdminExpenseId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);

/** Accounting ports keep persistence, visibility confirmation and transactional audit together. */
export interface AdminAccountingHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly allowedAdminExpenseStatuses: ReadonlySet<AdminExpenseStatus>;
  readonly isNonEmptySponsorText: (
    value: unknown,
    maxLength: number
  ) => value is string;
  readonly isValidOptionalBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly isValidOptionalNonEmptyBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly isValidOptionalIsoDate: (value: unknown) => boolean;
  readonly isValidAdminExpectedVersion: (value: unknown) => value is string;
  readonly listAdminExpenses: (
    expenseId?: string
  ) => Promise<AdminExpensesResponse>;
  readonly createAdminExpense: (
    input: AdminExpenseCreateRequest,
    audit: AdminExpenseAuditInput
  ) => Promise<AdminExpenseMutationResult>;
  readonly updateAdminExpense: (
    input: AdminExpenseUpdateRequest,
    audit: AdminExpenseAuditInput
  ) => Promise<AdminExpenseMutationResult>;
  readonly getPublicTransparencySummary: () => Promise<FundTransparencyPublicResponse>;
  readonly AdminExpenseValidationError: new (
    code: string,
    message: string
  ) => Error & { readonly code: string };
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Each owned route checks API access before reading private data or parsing a mutation. */
export const createAdminAccountingHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  allowedAdminExpenseStatuses,
  isNonEmptySponsorText,
  isValidOptionalBoundedText,
  isValidOptionalNonEmptyBoundedText,
  isValidOptionalIsoDate,
  isValidAdminExpectedVersion,
  listAdminExpenses,
  createAdminExpense,
  updateAdminExpense,
  getPublicTransparencySummary,
  AdminExpenseValidationError,
  reportFailure
}: AdminAccountingHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  const isAllowedAdminExpenseStatus = (
    value: unknown
  ): value is NonNullable<AdminExpenseUpdateRequest['status']> =>
    typeof value === 'string' &&
    allowedAdminExpenseStatuses.has(
      value as NonNullable<AdminExpenseUpdateRequest['status']>
    );

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/admin/expenses', '/api/admin/expenses')
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const expenseId = new URL(
          request.url ?? '/',
          'http://localhost'
        ).searchParams.get('expenseId');
        response.setHeader('Cache-Control', 'no-store');
        if (
          expenseId !== null &&
          (!/^[1-9]\d{0,18}$/.test(expenseId) ||
            BigInt(expenseId) > 9223372036854775807n)
        ) {
          writeJson(request, response, 400, { error: 'Invalid expenseId.' });
          return true;
        }
        const result = await listAdminExpenses(expenseId ?? undefined);
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin expenses.', error);
        writeJson(request, response, 502, {
          error: 'Admin expenses could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/admin/expenses', '/api/admin/expenses')
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminExpenseCreateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminExpenseCreateRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid allocation payload.');
        }
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid expense request body.'
        });
        return true;
      }

      if (
        !isNonEmptySponsorText(
          parsed.projectName,
          ADMIN_EXPENSE_NAME_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense project name is invalid.'
        });
        return true;
      }

      if (
        !isNonEmptySponsorText(
          parsed.publicDescription,
          ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense public description is invalid.'
        });
        return true;
      }

      if (
        !isNonEmptySponsorText(
          parsed.expectedOutcome,
          ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense expected outcome is invalid.'
        });
        return true;
      }

      if (!isAllowedFundAchievementProgressStatus(parsed.progressStatus)) {
        writeJson(request, response, 400, {
          error: 'Expense progress status is invalid.'
        });
        return true;
      }

      if (!isPublicAllocationProofUrl(parsed.proofUrl)) {
        writeJson(request, response, 400, {
          code: 'invalid_proof',
          error: 'Expense proof URL is invalid.'
        });
        return true;
      }

      if (!isValidOptionalBoundedText(parsed.proofSource, 500)) {
        writeJson(request, response, 400, {
          error: 'Expense proof source is invalid.'
        });
        return true;
      }

      if (!isValidOptionalIsoDate(parsed.proofPublishedAt)) {
        writeJson(request, response, 400, {
          error: 'Expense proof date is invalid.'
        });
        return true;
      }

      if (allocationAmountMinor(parsed.amountAllocated) === null) {
        writeJson(request, response, 400, {
          code: 'invalid_amount',
          error: 'Allocation amount must contain exact positive minor units.'
        });
        return true;
      }

      if (parsed.currency !== 'CAD') {
        writeJson(request, response, 400, {
          error: 'Expense currency is not supported.'
        });
        return true;
      }

      if (!isAllowedAdminExpenseStatus(parsed.status)) {
        writeJson(request, response, 400, {
          error: 'Expense status is invalid.'
        });
        return true;
      }

      if (!isValidOptionalIsoDate(parsed.publishedAt)) {
        writeJson(request, response, 400, {
          error: 'Expense published date is invalid.'
        });
        return true;
      }

      try {
        const result = await createAdminExpense(parsed, {
          actor: getAdminAuditActor(request),
          action: 'achievement.created'
        });
        if (!result.updated || !result.expense) {
          writeJson(request, response, 404, {
            error:
              'Expense could not be created or fund_allocations is missing.'
          });
          return true;
        }

        writeJson(request, response, 200, result);
      } catch (error) {
        if (error instanceof AdminExpenseValidationError) {
          writeJson(request, response, 400, {
            code: error.code,
            error: error.message
          });
          return true;
        }
        reportFailure('Failed to create admin expense.', error);
        writeJson(request, response, 502, {
          error: 'Admin expense could not be created.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/expenses/update',
        '/api/admin/expenses/update'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: AdminExpenseUpdateRequest;
      try {
        const body = await readBody(request);
        parsed = JSON.parse(body) as AdminExpenseUpdateRequest;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid allocation payload.');
        }
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid expense update request body.'
        });
        return true;
      }

      if (!isValidAdminExpenseId(parsed.expenseId)) {
        writeJson(request, response, 400, {
          error: 'Invalid expense id.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(parsed.expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Invalid expense version.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.projectName,
          ADMIN_EXPENSE_NAME_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense project name is invalid.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.publicDescription,
          ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense public description is invalid.'
        });
        return true;
      }

      if (
        !isValidOptionalNonEmptyBoundedText(
          parsed.expectedOutcome,
          ADMIN_EXPENSE_DESCRIPTION_MAX_LENGTH
        )
      ) {
        writeJson(request, response, 400, {
          error: 'Expense expected outcome is invalid.'
        });
        return true;
      }

      if (
        parsed.progressStatus !== undefined &&
        !isAllowedFundAchievementProgressStatus(parsed.progressStatus)
      ) {
        writeJson(request, response, 400, {
          error: 'Expense progress status is invalid.'
        });
        return true;
      }

      if (!isPublicAllocationProofUrl(parsed.proofUrl)) {
        writeJson(request, response, 400, {
          code: 'invalid_proof',
          error: 'Expense proof URL is invalid.'
        });
        return true;
      }

      if (!isValidOptionalBoundedText(parsed.proofSource, 500)) {
        writeJson(request, response, 400, {
          error: 'Expense proof source is invalid.'
        });
        return true;
      }

      if (!isValidOptionalIsoDate(parsed.proofPublishedAt)) {
        writeJson(request, response, 400, {
          error: 'Expense proof date is invalid.'
        });
        return true;
      }

      if (
        parsed.amountAllocated !== undefined &&
        allocationAmountMinor(parsed.amountAllocated) === null
      ) {
        writeJson(request, response, 400, {
          code: 'invalid_amount',
          error: 'Allocation amount must contain exact positive minor units.'
        });
        return true;
      }

      if (parsed.currency !== undefined && parsed.currency !== 'CAD') {
        writeJson(request, response, 400, {
          error: 'Expense currency is not supported.'
        });
        return true;
      }

      if (
        parsed.status !== undefined &&
        !isAllowedAdminExpenseStatus(parsed.status)
      ) {
        writeJson(request, response, 400, {
          error: 'Expense status is invalid.'
        });
        return true;
      }

      if (!isValidOptionalIsoDate(parsed.publishedAt)) {
        writeJson(request, response, 400, {
          error: 'Expense published date is invalid.'
        });
        return true;
      }

      try {
        const action =
          parsed.status === 'published' || parsed.status === 'active'
            ? 'achievement.published'
            : parsed.status === 'private'
              ? 'achievement.hidden'
              : parsed.status === 'archived'
                ? 'achievement.archived'
                : parsed.progressStatus !== undefined
                  ? 'achievement.progress_changed'
                  : parsed.proofUrl !== undefined ||
                      parsed.proofSource !== undefined ||
                      parsed.proofPublishedAt !== undefined
                    ? 'achievement.proof_changed'
                    : 'achievement.updated';
        const result = await updateAdminExpense(parsed, {
          actor: getAdminAuditActor(request),
          action
        });
        if (!result.updated || !result.expense) {
          writeJson(request, response, 409, {
            code: 'version_conflict',
            error:
              'Allocation changed or is no longer available. Refresh before trying again.'
          });
          return true;
        }

        writeJson(request, response, 200, result);
      } catch (error) {
        if (error instanceof AdminExpenseValidationError) {
          writeJson(request, response, 400, {
            code: error.code,
            error: error.message
          });
          return true;
        }
        reportFailure('Failed to update admin expense.', error);
        writeJson(request, response, 502, {
          error: 'Admin expense could not be updated.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/transparency',
        '/api/admin/transparency'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const [publicSummary, expenses] = await Promise.all([
          getPublicTransparencySummary(),
          listAdminExpenses()
        ]);
        const lastUpdatedAt =
          new Date(publicSummary.last_updated_at).getTime() >
          new Date(expenses.last_updated_at).getTime()
            ? publicSummary.last_updated_at
            : expenses.last_updated_at;
        const result: AdminTransparencyResponse = {
          data_source: 'database',
          public_summary: publicSummary,
          expenses_summary: expenses.summary,
          expenses: expenses.expenses,
          last_updated_at: lastUpdatedAt
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin transparency.', error);
        writeJson(request, response, 502, {
          error: 'Admin transparency could not be loaded.'
        });
      }
      return true;
    }

    return false;
  };
};
