import { writeFile } from 'node:fs/promises';

import type { Page, TestInfo } from '@playwright/test';

export interface PublicationReviewCaptureMetadata {
  language: string;
  viewport: { width: number; height: number };
  /** State only the access configured by this fixture; absence means unknown. */
  access?: string;
}

/** Explicit successful-test attachments, consumed later by the local gallery. */
export async function capturePublicationReview(
  page: Page,
  testInfo: TestInfo,
  name: string,
  metadata: PublicationReviewCaptureMetadata
): Promise<void> {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name) ||
    /test-failed|^screenshot(?:-\d+)?$/i.test(name)
  )
    throw new Error('Use an explicit, safe publication-review capture name.');
  if (testInfo.attachments.some((attachment) => attachment.name === name))
    throw new Error('Use a distinct name for every capture in this test.');
  if (
    !metadata.language.trim() ||
    !Number.isFinite(metadata.viewport.width) ||
    !Number.isFinite(metadata.viewport.height) ||
    metadata.viewport.width <= 0 ||
    metadata.viewport.height <= 0
  )
    throw new Error('Supply the capture language and CSS viewport explicitly.');
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight
  }));
  if (
    viewport.width !== metadata.viewport.width ||
    viewport.height !== metadata.viewport.height
  )
    throw new Error(
      'The supplied CSS viewport does not match the rendered page.'
    );
  const image = testInfo.outputPath(`${name}.png`);
  const description = testInfo.outputPath(`${name}.json`);
  await page.screenshot({
    path: image,
    animations: 'disabled',
    fullPage: false
  });
  await writeFile(
    description,
    JSON.stringify(
      {
        version: 1,
        captureName: name,
        language: metadata.language,
        viewport: metadata.viewport,
        access: metadata.access ?? null,
        scope: 'synthetic-api-fixtures'
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  await testInfo.attach(name, { path: image, contentType: 'image/png' });
  await testInfo.attach(`${name}-metadata`, {
    path: description,
    contentType: 'application/json'
  });
}
