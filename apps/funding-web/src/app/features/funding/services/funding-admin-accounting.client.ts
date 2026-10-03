import type {
  AdminContributionsResponse,
  AdminContributionsExportRequest,
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpenseUpdateRequest,
  AdminExpensesResponse,
  AdminTransparencyResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Funding admin contributions, expenses and transparency endpoints. Authentication belongs to the shared session. */
export class FundingAdminAccountingClient {
  constructor(private readonly session: FundingAdminSession) {}

  async getContributions(
    token: string,
    contributionId?: string
  ): Promise<AdminContributionsResponse> {
    const params = contributionId
      ? '?' + new URLSearchParams({ contributionId })
      : '';
    const response = await this.session.requestAdminJson(
      `/admin/contributions${params}`,
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin contributions could not be loaded.');
    }

    return (await response.json()) as AdminContributionsResponse;
  }

  async getContributionsCsv(
    token: string,
    selection: AdminContributionsExportRequest
  ): Promise<string> {
    const response = await this.session.requestAdminJson(
      '/admin/contributions.csv',
      {
        auth: { token },
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'text/csv', 'Content-Type': 'application/json' },
        body: selection
      }
    );

    if (!response.ok) {
      throw new AdminDashboardRequestError(response.status);
    }

    return response.text();
  }

  async getExpenses(
    token: string,
    expenseId?: string
  ): Promise<AdminExpensesResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/expenses${expenseId ? '?expenseId=' + encodeURIComponent(expenseId) : ''}`,
      { auth: { token }, method: 'GET', cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error('Admin expenses could not be loaded.');
    }

    return (await response.json()) as AdminExpensesResponse;
  }

  async createExpense(
    token: string,
    payload: AdminExpenseCreateRequest
  ): Promise<AdminExpenseMutationResult> {
    const response = await this.session.requestAdminJson('/admin/expenses', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });

    if (!response.ok) {
      throw new Error('Admin expense could not be created.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async updateExpense(
    token: string,
    payload: AdminExpenseUpdateRequest
  ): Promise<AdminExpenseMutationResult> {
    const response = await this.session.requestAdminJson(
      '/admin/expenses/update',
      {
        auth: { token },
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );

    if (!response.ok) {
      if (response.status === 409) throw new Error('version_conflict');
      throw new Error('Admin expense could not be updated.');
    }

    return (await response.json()) as AdminExpenseMutationResult;
  }

  async getTransparency(token: string): Promise<AdminTransparencyResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/transparency',
      { auth: { token }, method: 'GET' }
    );

    if (!response.ok) {
      throw new Error('Admin transparency could not be loaded.');
    }

    return (await response.json()) as AdminTransparencyResponse;
  }
}
