import type { DevToolsCommand } from '../../components/dev-tools/dev-tools-command.js';
import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

export type StripeSetupPaymentMode = 'test' | 'live';

export type SetupStepStatus = 'manual' | 'verified' | 'blocked';
export type SetupStageState = 'complete' | 'active' | 'pending';

export type SetupCommand = DevToolsCommand;

export interface SetupLink {
  readonly label: string;
  readonly url: string;
}

export interface SetupStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: SetupStepStatus;
  readonly statusLabel: string;
  readonly commands: readonly SetupCommand[];
  readonly links: readonly SetupLink[];
  readonly checklist: readonly string[];
}

export interface SetupStage {
  readonly number: number;
  readonly title: string;
  readonly detail: string;
  readonly state: SetupStageState;
}

export interface SecurityCheck {
  readonly label: string;
  readonly state: 'complete' | 'progress';
}

export interface StripeSetupAccountDiagnostic {
  readonly connected: boolean;
  readonly connectionLabel: string;
  readonly dashboardUrl: string;
  readonly payoutsReady: boolean;
  readonly payoutLabel: string;
}

export interface StripeSetupWebhookDiagnostic {
  readonly configured: boolean;
  readonly statusLabel: string;
  readonly endpoint: string;
  readonly dashboardUrl: string;
}

export function stripeSetupAccountDiagnostic(
  status: StripeSetupDevStatus
): StripeSetupAccountDiagnostic {
  return {
    connected: status.apiReachable,
    connectionLabel: status.apiReachable
      ? 'Compte Stripe connecte'
      : 'Connexion Stripe a verifier',
    dashboardUrl: status.stripeDashboardUrl,
    payoutsReady: status.stripeSecretKeyConfigured,
    payoutLabel: status.stripeSecretKeyConfigured
      ? 'Versements consultables'
      : 'Cle Stripe a verifier'
  };
}

export function stripeSetupWebhookDiagnostic(
  status: StripeSetupDevStatus
): StripeSetupWebhookDiagnostic {
  return {
    configured: status.stripeWebhookSecretConfigured,
    statusLabel: status.stripeWebhookSecretConfigured
      ? 'Actif'
      : 'A configurer',
    endpoint: status.webhookEndpoint,
    dashboardUrl: status.stripeDashboardUrl
  };
}

export function stripeSetupTransparencySourceLabel(
  source: StripeSetupDevStatus['transparencySource']
): string {
  if (source === 'database') return 'PostgreSQL actif';
  if (source === 'stripe') return 'Stripe direct';
  return 'A configurer';
}

export function stripeSetupStages(
  status: StripeSetupDevStatus,
  paymentMode: StripeSetupPaymentMode
): readonly SetupStage[] {
  const keysReady =
    status.stripeSecretKeyConfigured && status.stripeWebhookSecretConfigured;

  return [
    {
      number: 1,
      title: 'Connecter le compte',
      detail: status.apiReachable ? 'Termine' : 'A faire',
      state: status.apiReachable ? 'complete' : 'pending'
    },
    {
      number: 2,
      title: 'Transparence',
      detail: stripeSetupTransparencySourceLabel(status.transparencySource),
      state:
        status.transparencySource !== 'none'
          ? 'complete'
          : status.apiReachable
            ? 'active'
            : 'pending'
    },
    {
      number: 3,
      title: 'Cles API',
      detail: keysReady ? 'Termine' : 'En cours',
      state: keysReady ? 'complete' : 'active'
    },
    {
      number: 4,
      title: 'Webhooks',
      detail: status.stripeWebhookSecretConfigured ? 'Termine' : 'A faire',
      state: status.stripeWebhookSecretConfigured ? 'complete' : 'pending'
    },
    {
      number: 5,
      title: 'Paiements en direct',
      detail: keysReady && paymentMode === 'live' ? 'Pret' : 'A faire',
      state: keysReady && paymentMode === 'live' ? 'complete' : 'pending'
    }
  ];
}

export function stripeSetupSecurityChecks(
  status: StripeSetupDevStatus
): readonly SecurityCheck[] {
  return [
    {
      label: 'Utiliser des cles API restreintes',
      state: status.stripeSecretKeyConfigured ? 'complete' : 'progress'
    },
    { label: "Activer l'authentification 2FA", state: 'complete' },
    {
      label: 'Configurer les webhooks',
      state: status.stripeWebhookSecretConfigured ? 'complete' : 'progress'
    },
    { label: 'Limiter les acces aux cles secretes', state: 'complete' },
    {
      label: 'Surveiller les evenements Stripe',
      state: status.apiReachable ? 'complete' : 'progress'
    }
  ];
}

export function stripeSetupSteps(
  status: StripeSetupDevStatus
): readonly SetupStep[] {
  return [
    {
      id: 'install',
      title: 'Installer les dependances locales',
      description: 'Active Corepack et installe les workspaces Yarn du projet.',
      status: 'manual',
      statusLabel: 'Commande locale',
      checklist: ['Node 22.x est installe', 'Corepack est disponible'],
      commands: [
        {
          label: 'Installation',
          value: 'corepack enable; corepack yarn install'
        }
      ],
      links: []
    },
    {
      id: 'database',
      title: 'Sans PostgreSQL au lancement',
      description:
        'Pour le lancement rapide, les statistiques publiques lisent Stripe directement. PostgreSQL reste une option future seulement.',
      status: 'verified',
      statusLabel: status.databaseReachable ? 'Journal actif' : 'Non requis',
      checklist: [
        status.transparencySource === 'stripe'
          ? 'Mode lancement rapide: Stripe direct'
          : 'Stripe direct en attente de cle API',
        'Laisser DATABASE_URL vide pour ce lancement',
        status.databaseReachable
          ? 'Journal PostgreSQL actif par configuration locale'
          : 'Aucune base PostgreSQL requise'
      ],
      commands: [],
      links: []
    },
    {
      id: 'stripe-secret',
      title: 'Configurer la cle secrete Stripe',
      description:
        'Recupere la cle test dans Stripe et injecte-la seulement dans le terminal API.',
      status: status.stripeSecretKeyConfigured ? 'verified' : 'manual',
      statusLabel: status.stripeSecretKeyConfigured ? 'Verifie' : 'A faire',
      checklist: [
        status.stripeSecretKeyConfigured
          ? 'STRIPE_SECRET_KEY est configuree cote API'
          : 'STRIPE_SECRET_KEY manque cote API'
      ],
      commands: [
        {
          label: 'PowerShell',
          value: '$env:STRIPE_SECRET_KEY="sk_test_REMPLACE_MOI"'
        }
      ],
      links: [
        {
          label: 'Cles API Stripe',
          url: 'https://dashboard.stripe.com/test/apikeys'
        }
      ]
    },
    {
      id: 'stripe-cli',
      title: 'Connecter Stripe CLI',
      description:
        'Connecte Stripe CLI, puis redirige les evenements vers le webhook local.',
      status: 'manual',
      statusLabel: 'Manuel',
      checklist: [
        'stripe login ouvre le navigateur',
        'stripe listen affiche un secret whsec_...'
      ],
      commands: [
        {
          label: 'Connexion',
          value: 'stripe login'
        },
        {
          label: 'Ecoute webhook',
          value: 'stripe listen --forward-to localhost:3333/api/stripe/webhook'
        }
      ],
      links: [
        {
          label: 'Documentation Stripe CLI',
          url: 'https://docs.stripe.com/stripe-cli'
        },
        {
          label: 'Webhooks Stripe',
          url: status.stripeDashboardUrl
        }
      ]
    },
    {
      id: 'webhook-secret',
      title: 'Ajouter le secret webhook',
      description:
        'Copie le whsec affiche par Stripe CLI dans la session qui lance le backend.',
      status: status.stripeWebhookSecretConfigured ? 'verified' : 'manual',
      statusLabel: status.stripeWebhookSecretConfigured ? 'Verifie' : 'A faire',
      checklist: [
        status.stripeWebhookSecretConfigured
          ? 'STRIPE_WEBHOOK_SECRET est configuree cote API'
          : 'STRIPE_WEBHOOK_SECRET manque cote API'
      ],
      commands: [
        {
          label: 'PowerShell',
          value: '$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"'
        }
      ],
      links: [
        {
          label: 'Webhook local',
          url: status.webhookEndpoint
        }
      ]
    },
    {
      id: 'run-app',
      title: "Demarrer le site et l'API",
      description:
        'Lance le serveur Angular avec le proxy et le backend Stripe local.',
      status: status.apiReachable ? 'verified' : 'blocked',
      statusLabel: status.apiReachable ? 'API joignable' : 'Non joignable',
      checklist: [
        `API locale: ${status.localApiBaseUrl}`,
        `Checkout: ${status.checkoutEndpoint}`
      ],
      commands: [
        {
          label: 'Dev',
          value: 'corepack yarn dev'
        }
      ],
      links: [
        {
          label: 'Site local',
          url: 'http://localhost:8080'
        }
      ]
    },
    {
      id: 'test-events',
      title: 'Declencher les evenements test',
      description:
        'Envoie les evenements Stripe MVP pour verifier le paiement, l expiration, les echecs, les remboursements et les versements.',
      status: 'manual',
      statusLabel: 'Commande locale',
      checklist: [
        'Le terminal stripe listen doit rester ouvert pendant ce test'
      ],
      commands: [
        {
          label: 'Session completee',
          value: 'stripe trigger checkout.session.completed'
        },
        {
          label: 'Session expiree',
          value: 'stripe trigger checkout.session.expired'
        },
        {
          label: 'Paiement',
          value: 'stripe trigger payment_intent.succeeded'
        },
        {
          label: 'Paiement refuse',
          value: 'stripe trigger payment_intent.payment_failed'
        },
        {
          label: 'Remboursement',
          value: 'stripe trigger charge.refunded'
        },
        {
          label: 'Litige',
          value: 'stripe trigger charge.dispute.created'
        },
        {
          label: 'Versement paye',
          value: 'stripe trigger payout.paid'
        },
        {
          label: 'Versement echoue',
          value: 'stripe trigger payout.failed'
        }
      ],
      links: []
    },
    {
      id: 'transparency',
      title: 'Verifier la transparence publique',
      description:
        "Confirme que l'API agregee et la page publique repondent localement.",
      status: status.apiReachable ? 'verified' : 'blocked',
      statusLabel: status.apiReachable ? 'Pret a verifier' : 'API requise',
      checklist: ['Les donnees doivent rester agregees et anonymes'],
      commands: [
        {
          label: 'API',
          value:
            'Invoke-RestMethod -Uri "http://localhost:3333/api/public/fund-transparency" -Method Get | ConvertTo-Json -Depth 6'
        }
      ],
      links: [
        {
          label: 'Endpoint API',
          url: status.publicTransparencyEndpoint
        },
        {
          label: 'Page publique',
          url: 'http://localhost:8080/fonds-des-batisseurs/transparence'
        }
      ]
    }
  ];
}
