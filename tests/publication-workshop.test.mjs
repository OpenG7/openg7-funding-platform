import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildWorkshopMission } from '../dist/apps/funding-api/src/preflight/workshop-source.js';
import { projectWorkshopProposals } from '../dist/apps/funding-api/src/preflight/workshop-proposal.js';
import {
  assertPreflightProducerActivation,
  loadPreflightConfig
} from '../dist/apps/funding-api/src/preflight/config.js';
import {
  loadPreflightInboxConfig,
  loadPreflightWorkshopConfig
} from '../dist/apps/funding-api/src/preflight/inbox-config.js';
import { runPreflightWorker } from '../dist/apps/funding-api/src/preflight-worker.js';
import { workshopRemoteDetail } from './support/publication-workshop-fixture.mjs';

const config = { enabled: true, tenantId: 'synthetic-workshop', maxCostUsd: 0 };

test('connector and workshop activate independently while inbox remains separate', () => {
  const env = {
    FUNDING_PLATFORM_ENV: 'test',
    PREFLIGHT_URL: 'https://preflight.invalid',
    PREFLIGHT_TOKEN_URL: 'https://identity.invalid/token',
    PREFLIGHT_TENANT_ID: 'synthetic-tenant',
    PREFLIGHT_CLIENT_ID: 'synthetic-client',
    PREFLIGHT_CLIENT_SECRET: 'synthetic-secret'
  };
  assert.deepEqual(loadPreflightWorkshopConfig(env), { enabled: false });
  for (const workshopEnabled of [false, true]) {
    const selected = {
      ...env,
      PREFLIGHT_ENABLED: String(!workshopEnabled),
      PREFLIGHT_WORKSHOP_ENABLED: String(workshopEnabled)
    };
    assert.doesNotThrow(() => assertPreflightProducerActivation(selected));
    assert.equal(loadPreflightConfig(selected).enabled, !workshopEnabled);
    assert.equal(
      loadPreflightWorkshopConfig(selected).enabled,
      workshopEnabled
    );
    assert.equal(loadPreflightInboxConfig(selected).connection.enabled, false);
  }
  assert.throws(
    () => loadPreflightWorkshopConfig({ PREFLIGHT_WORKSHOP_ENABLED: 'yes' }),
    { code: 'preflight_workshop_enabled_invalid' }
  );
});

test('dual producers are rejected before secret access, database or worker startup', async () => {
  const env = {
    PREFLIGHT_ENABLED: 'true',
    PREFLIGHT_WORKSHOP_ENABLED: 'true',
    PREFLIGHT_CLIENT_SECRET_FILE: 'synthetic-missing-secret-file'
  };
  assert.throws(() => loadPreflightWorkshopConfig(env), {
    code: 'preflight_producers_mutually_exclusive'
  });
  await assert.rejects(runPreflightWorker(env), {
    code: 'preflight_producers_mutually_exclusive'
  });
});
const source = (consent = true) => ({
  contributionId: randomUUID(),
  commitmentId: randomUUID(),
  commitmentVersion: 3,
  active: true,
  publicConsent: consent,
  displayName: consent ? 'Synthetic public partner' : null,
  summary: consent ? 'Synthetic allowed presentation' : null,
  amountMinor: 25000,
  currency: 'CAD',
  reference: 'SYNTHETIC',
  reviewed: true,
  websiteHeld: true,
  missingInformation: consent ? [] : ['public_name_consent', 'public_name'],
  digest: 'a'.repeat(64),
  destinations: [
    {
      destination: 'facebook',
      obligationId: randomUUID(),
      obligationVersion: 2,
      format: 'collective',
      target: 'openg7'
    }
  ],
  mediaVersions: [],
  mediaPreparationVersions: [],
  consentRecordId: null,
  draftBaseline: []
});
const mission = (consent = true) =>
  buildWorkshopMission(config, source(consent), 4, randomUUID(), randomUUID());

test('workshop wire input excludes contact data, unconsented identity, financial amounts and manual drafts', () => {
  const snapshot = {
    ...source(false),
    privateEmail: 'private@example.invalid',
    privateName: 'PRIVATE_SYNTHETIC',
    draftBaseline: [{ title: 'PRIVATE_MANUAL_DRAFT' }]
  };
  const payload = buildWorkshopMission(
    config,
    snapshot,
    4,
    randomUUID(),
    randomUUID()
  );
  assert.doesNotMatch(
    JSON.stringify(payload),
    /private@example|PRIVATE_SYNTHETIC|PRIVATE_MANUAL_DRAFT|25000|amountMinor|currency/
  );
  assert.equal(payload.constraints.humanApprovalRequired, true);
  assert.equal(payload.input.preparationOnly, true);
  assert.deepEqual(payload.input.editorialContext.sourceFacts, []);
  assert.equal(payload.source.version, 4);
  assert.equal(payload.input.editorialContext.commitmentVersion, 3);
});

test('partial and review-ready remote proposals retain mock provenance and never grant delivery', () => {
  for (const consent of [false, true]) {
    const input = mission(consent),
      detail = workshopRemoteDetail(input);
    const [proposal] = projectWorkshopProposals(detail, input);
    assert.equal(proposal.provenance.simulated, true);
    assert.equal(proposal.editorialPreparation.publicationAuthorized, false);
    assert.equal(
      proposal.editorialPreparation.state,
      consent ? 'ready_for_review' : 'partial'
    );
    assert.equal(
      proposal.editorialPreparation.variants[0].obligationVersion,
      2
    );
    if (!consent)
      assert.equal(proposal.editorialPreparation.variants[0].body, '');
  }
});

test('remote tenant, source, checks, model provenance and editorial scope are revalidated', () => {
  for (const tamper of [
    (d) => {
      d.mission.tenantId = 'other-tenant';
    },
    (d) => {
      d.proposals[0].tenantId = 'other-tenant';
    },
    (d) => {
      d.proposals[0].source = { ...d.proposals[0].source, version: 99 };
    },
    (d) => {
      d.proposals[0].checks[0].passed = false;
    },
    (d) => {
      d.results[0].obsolete = true;
    },
    (d) => {
      d.results[0].output.complete = false;
    },
    (d) => {
      d.results.find(
        (r) => r.kind === 'preparation-policy'
      ).output.externalPublicationAllowed = true;
    },
    (d) => {
      d.proposals[0].editorialPreparation.variants[0].obligationId =
        randomUUID();
    },
    (d) => {
      d.proposals[0].editorialPreparation.variants[0].publicationAuthorized = true;
    },
    (d) => {
      d.proposals[0].provenance = {
        ...d.proposals[0].provenance,
        simulated: false
      };
    },
    (d) => {
      d.proposals[0].editorialPreparation.common.sourceFacts.push({
        key: 'invented',
        value: 'untrusted'
      });
    }
  ]) {
    const input = mission(),
      detail = structuredClone(workshopRemoteDetail(input));
    tamper(detail);
    assert.throws(
      () => projectWorkshopProposals(detail, input),
      /PUBLICATION_WORKSHOP_RESPONSE/
    );
  }
  const input = mission(false),
    detail = workshopRemoteDetail(input);
  detail.proposals[0].editorialPreparation.common.missingInformation = [];
  assert.throws(
    () => projectWorkshopProposals(detail, input),
    /PUBLICATION_WORKSHOP_RESPONSE/
  );
});
