import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const assertIncludesAll = (source, values, label) => {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${value}`);
  }
};

test('the assistant is wired into the Angular admin shell', () => {
  const routes = read('apps/funding-web/src/app/app.routes.ts');
  const nav = read(
    'apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts'
  );
  const service = read(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts'
  );
  const page = read(
    'apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.ts'
  );

  assertIncludesAll(
    routes,
    ['admin/fundraiser/assistant', 'AdminAssistantPageComponent'],
    'app.routes.ts'
  );
  assertIncludesAll(
    nav,
    ['/admin/fundraiser/assistant', 'Assistant'],
    'admin-nav'
  );
  assertIncludesAll(
    service,
    [
      'getAssistantSummary',
      'queryAssistant',
      'prepareAssistantDraft',
      '/admin/assistant/summary',
      '/admin/assistant/query',
      '/admin/assistant/prepare'
    ],
    'funding-admin.service'
  );
  assertIncludesAll(
    page,
    [
      'openg7-admin-assistant-page',
      'Fiches commanditaires incomplètes',
      'Commandites à réviser',
      'Publications à préparer',
      'Publications en retard',
      'Courriels échoués',
      'Avertissements financiers',
      'Poser une question',
      'lecture seule'
    ],
    'admin-assistant-page'
  );
});

test('the assistant prepares drafts (iteration 2) as generation only', () => {
  const api = read('apps/funding-api/src/main.ts');
  const preparation = read(
    'apps/funding-api/src/admin-assistant/preparation.service.ts'
  );
  const page = read(
    'apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.ts'
  );

  assertIncludesAll(
    api,
    [
      '/admin/assistant/prepare',
      '/api/admin/assistant/prepare',
      'prepareAdminAssistantDraft',
      "'admin_assistant.prepare'"
    ],
    'main.ts prepare endpoint'
  );
  assertIncludesAll(
    preparation,
    ['sent: false', 'published: false', 'persisted: false', 'GENERATION ONLY'],
    'preparation.service'
  );
  assertIncludesAll(
    page,
    ['prepare_reminder', 'Non envoyé · non publié', 'prepareAssistantDraft'],
    'admin-assistant-page prepare UI'
  );
});

test('the admin assistant page exposes every required UI state', () => {
  const page = read(
    'apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.ts'
  );
  assertIncludesAll(
    page,
    [
      "summaryState() === 'loading'",
      "summaryState() === 'error'",
      "answerState() === 'loading'",
      'Assistant conversationnel désactivé',
      'Modèle non configuré',
      'Délai dépassé',
      'Erreur du fournisseur',
      'Aucun résultat pour cette question',
      'Aucune action urgente'
    ],
    'admin-assistant-page states'
  );
});

test('the API exposes the read-only assistant endpoints with guards', () => {
  const api = read('apps/funding-api/src/main.ts');
  assertIncludesAll(
    api,
    [
      '/admin/assistant/summary',
      '/api/admin/assistant/summary',
      '/admin/assistant/query',
      '/api/admin/assistant/query',
      'buildAdminAssistantSummary',
      'runAdminAssistantQuery',
      'recordAdminAssistantAudit',
      'adminAssistantConfig.maxMessageLength'
    ],
    'main.ts assistant endpoints'
  );
  // The query endpoint must never GET, and the summary must stay behind admin
  // access (deterministic fallback still requires authentication).
  assert.ok(
    api.includes("entityType: 'admin_assistant'"),
    'assistant usage must be audited'
  );
});

test('the assistant ships disabled by default and never exposes the API key', () => {
  const env = read('.env.example');
  assertIncludesAll(
    env,
    [
      'ADMIN_AI_ASSISTANT_ENABLED=false',
      'ADMIN_AI_PROVIDER=',
      'ADMIN_AI_MODEL=',
      'ADMIN_AI_API_KEY=',
      'ADMIN_AI_MAX_TOOL_CALLS=',
      'ADMIN_AI_TIMEOUT_MS=',
      'ADMIN_AI_MAX_MESSAGE_LENGTH=',
      'ADMIN_AI_MAX_ITEMS_PER_TOOL='
    ],
    '.env.example'
  );

  const config = read('apps/funding-api/src/admin-assistant/config.ts');
  assert.ok(
    config.includes('never logged'),
    'the config must document that the API key is never logged'
  );
  const provider = read('apps/funding-api/src/admin-assistant/provider.ts');
  assert.ok(
    !provider.includes('ADMIN_AI_API_KEY'),
    'no provider should read the API key while no live provider is wired'
  );
});
