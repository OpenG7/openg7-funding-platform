import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';
import {
  MODERATION_POLICY_VERSION,
  type AdminSponsorshipsResponse,
  type ModerationContent,
  type ModerationDecisionInput,
  type ModerationSubject,
  type SponsorshipMediaResponse
} from '@openg7/funding-core';

import { adminSessionHeaders } from './admin-auth.js';
import { completeModeration } from './moderation.js';
import { expect } from './test.js';

/** Read the exact persisted synthetic content; never fabricate an approval snapshot. */
export async function acceptanceModerationDecision(
  request: APIRequestContext,
  subject: ModerationSubject,
  headers?: Record<string, string>
): Promise<ModerationDecisionInput> {
  const response = await request.get('/api/admin/moderation/content', {
    headers: headers ?? (await adminSessionHeaders(request)),
    params: { subjectType: subject.type, subjectId: subject.id }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const content = (await response.json()) as ModerationContent;
  expect(content.subject).toEqual(subject);
  return {
    requestId: randomUUID(),
    policyVersion: MODERATION_POLICY_VERSION,
    contentVersion: content.contentVersion,
    contentFingerprint: content.fingerprint,
    expectedDecisionId: content.currentDecisionId,
    confirmation: subject.id,
    level: 'N0'
  };
}

/** Explicit editorial review of one already business-approved, disposable fixture. */
export async function approveAcceptanceFixture(
  request: APIRequestContext,
  reference: string,
  includeSponsor = true
): Promise<string> {
  const headers = await adminSessionHeaders(request);
  const response = await request.get('/api/admin/sponsorships', {
    headers,
    params: { search: reference }
  });
  expect(response.ok()).toBe(true);
  const records = (await response.json()) as AdminSponsorshipsResponse;
  expect(records.items).toHaveLength(1);
  const record = records.items[0]!;
  expect(record.public_reference).toBe(reference);
  if (includeSponsor) expect(record.sponsor_review_status).toBe('approved');
  const mediaResponse = await request.get('/api/admin/sponsorships/media', {
    headers,
    params: { contributionId: record.id }
  });
  expect(mediaResponse.ok()).toBe(true);
  const media = (await mediaResponse.json()) as SponsorshipMediaResponse;
  const subjects: ModerationSubject[] = [
    ...media.assets
      .filter((asset) => asset.reviewStatus === 'approved')
      .map((asset): ModerationSubject => ({ type: 'media', id: asset.id })),
    ...(includeSponsor ? [{ type: 'sponsorship' as const, id: record.id }] : [])
  ];
  for (const subject of subjects) {
    await approveAcceptanceSubject(request, subject);
  }
  return record.id;
}

export async function approveAcceptanceSubject(
  request: APIRequestContext,
  subject: ModerationSubject
): Promise<void> {
  const decision = await acceptanceModerationDecision(request, subject);
  const approved = await request.post('/api/admin/moderation/decisions', {
    headers: await adminSessionHeaders(request),
    data: { subject, decision }
  });
  expect(approved.ok(), await approved.text()).toBe(true);
  expect((await approved.json()).decision).toMatchObject({
    subject,
    level: 'N0',
    state: 'active'
  });
}

async function completeSequence(page: Page, count: number): Promise<void> {
  expect(count).toBeGreaterThan(0);
  const snapshot = page.locator('[data-og7="moderation-snapshot"]');
  for (let index = 0; index < count; index++) {
    await expect(snapshot).toBeAttached();
    const previous = await snapshot.textContent();
    await completeModeration(page);
    if (index + 1 < count) await expect(snapshot).not.toHaveText(previous!);
  }
}

/** Complete each actual media decision, preserving the real bulk-review endpoint. */
export async function approveAllAcceptanceMedia(page: Page): Promise<void> {
  const approve = page.getByRole('button', {
    name: 'Approuver le media',
    exact: true
  });
  await expect(approve.first()).toBeVisible();
  const count = await approve.count();
  await page
    .getByRole('button', { name: 'Tout approuver', exact: true })
    .click();
  await completeSequence(page, count);
}

/** Pending sponsors are reviewed individually before the exact final delivery. */
export async function completePublicationModeration(page: Page): Promise<void> {
  const pending = await page
    .locator('[data-og7="publication-sponsor-review"] li a')
    .count();
  await completeSequence(page, pending + 1);
}
