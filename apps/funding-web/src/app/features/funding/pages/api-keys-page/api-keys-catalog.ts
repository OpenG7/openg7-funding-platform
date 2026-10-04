import type { DevToolsCommand } from '../../components/dev-tools/dev-tools-command.js';
import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

export interface ApiKeyCard {
  readonly id: 'publishable' | 'secret' | 'webhook' | 'environment';
  readonly title: string;
  readonly maskedValue: string;
  readonly statusLabel: string;
  readonly configured: boolean;
  readonly command: string;
  readonly icon: string;
}

export interface ApiKeyPermission {
  readonly name: string;
  readonly read: boolean;
  readonly write: boolean;
  readonly required: boolean;
}

export interface ApiKeyRotationStep {
  readonly title: string;
  readonly detail: string;
}

export interface ApiKeyAuditRow {
  readonly time: string;
  readonly event: string;
  readonly status: string;
  readonly detail: string;
  readonly tone: 'ok' | 'warn' | 'error';
}

export interface ApiKeyCommand extends DevToolsCommand {
  readonly id: 'secret' | 'webhook' | 'api' | 'web';
}

export const API_KEY_ROTATION_STEPS: readonly ApiKeyRotationStep[] = [
  {
    title: 'Creer une nouvelle cle restreinte',
    detail:
      'Generez la cle dans Stripe avec seulement les permissions necessaires.'
  },
  {
    title: 'Deployer la variable cote API',
    detail:
      'Injectez la nouvelle valeur dans le terminal ou le secret manager du backend.'
  },
  {
    title: 'Revalider Stripe Setup',
    detail:
      'Verifiez que checkout, webhooks et transparence repondent localement.'
  },
  {
    title: "Revoquer l'ancienne cle",
    detail:
      'Supprimez seulement apres validation et surveillance des logs Stripe.'
  }
];

export const API_KEY_PERMISSIONS: readonly ApiKeyPermission[] = [
  { name: 'checkout.sessions', read: true, write: true, required: true },
  { name: 'payment_intents', read: true, write: true, required: true },
  { name: 'charges', read: true, write: false, required: true },
  { name: 'refunds', read: true, write: true, required: true },
  { name: 'payouts', read: true, write: false, required: false },
  { name: 'webhook_endpoints', read: true, write: true, required: false }
];

export const API_KEY_AUDIT_ROWS: readonly ApiKeyAuditRow[] = [
  {
    time: '10:46',
    event: 'Cle secrete detectee cote API',
    status: 'OK',
    detail: 'STRIPE_SECRET_KEY est visible uniquement par le backend.',
    tone: 'ok'
  },
  {
    time: '10:42',
    event: 'Webhook secret verifie',
    status: 'OK',
    detail: 'Les signatures Stripe peuvent etre validees.',
    tone: 'ok'
  },
  {
    time: '10:31',
    event: 'Rotation recommandee',
    status: 'A planifier',
    detail: 'Une rotation reguliere limite les risques operationnels.',
    tone: 'warn'
  },
  {
    time: '10:20',
    event: 'Cle exposee dans client',
    status: 'Bloque',
    detail: 'Aucun secret ne doit etre ajoute au bundle Angular.',
    tone: 'error'
  }
];

export const API_KEY_COMMANDS: readonly ApiKeyCommand[] = [
  {
    id: 'secret',
    label: 'Cle secrete',
    value: '$env:STRIPE_SECRET_KEY="sk_test_REMPLACE_MOI"'
  },
  {
    id: 'webhook',
    label: 'Webhook secret',
    value: '$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"'
  },
  { id: 'api', label: 'API locale', value: 'corepack yarn dev:api' },
  { id: 'web', label: 'Web local', value: 'corepack yarn dev:web' }
];

/** Projects only diagnostic flags and synthetic masked values; the browser receives no secrets. */
export function projectApiKeyCards(
  status: StripeSetupDevStatus
): readonly ApiKeyCard[] {
  return [
    {
      id: 'publishable',
      title: 'Cle publiable',
      maskedValue: 'pk_live_************************',
      statusLabel: 'Utilisable cote client',
      configured: true,
      command: 'pk_live_REMPLACE_MOI',
      icon: '◇'
    },
    {
      id: 'secret',
      title: 'Cle secrete',
      maskedValue: 'sk_live_************************',
      statusLabel: status.stripeSecretKeyConfigured
        ? 'Configuree cote API'
        : 'Manquante cote API',
      configured: status.stripeSecretKeyConfigured,
      command: '$env:STRIPE_SECRET_KEY="sk_live_REMPLACE_MOI"',
      icon: '⚿'
    },
    {
      id: 'webhook',
      title: 'Secret webhook',
      maskedValue: 'whsec_************************',
      statusLabel: status.stripeWebhookSecretConfigured
        ? 'Configure cote API'
        : 'Manquant cote API',
      configured: status.stripeWebhookSecretConfigured,
      command: '$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"',
      icon: '◈'
    },
    {
      id: 'environment',
      title: 'Environnement',
      maskedValue: status.localApiBaseUrl,
      statusLabel: status.apiReachable
        ? 'API locale joignable'
        : 'API locale a verifier',
      configured: status.apiReachable,
      command: 'corepack yarn dev:api',
      icon: '◎'
    }
  ];
}
