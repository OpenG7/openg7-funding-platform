import type { DevToolsCommand } from '../../components/dev-tools/dev-tools-command.js';
import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

export interface WebhookEvent {
  readonly name: string;
  readonly category: string;
  readonly impact: string;
  readonly tone: 'green' | 'gold' | 'blue' | 'red';
}

export interface WebhookDiagnostic {
  readonly time: string;
  readonly event: string;
  readonly result: string;
  readonly impact: string;
  readonly tone: 'ok' | 'warn' | 'error';
}

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  {
    name: 'checkout.session.completed',
    category: 'Contribution',
    impact:
      'Confirme une session de paiement et prepare la contribution publique.',
    tone: 'green'
  },
  {
    name: 'checkout.session.expired',
    category: 'Expiration',
    impact: "Marque une session abandonnee sans l'ajouter aux totaux.",
    tone: 'gold'
  },
  {
    name: 'payment_intent.succeeded',
    category: 'Contribution',
    impact: 'Ajoute le montant brut confirme aux totaux du fonds.',
    tone: 'green'
  },
  {
    name: 'charge.refunded',
    category: 'Remboursement',
    impact: 'Deduit les montants rembourses et garde une trace agregee.',
    tone: 'gold'
  },
  {
    name: 'charge.dispute.created',
    category: 'Litige',
    impact: 'Marque la contribution comme contestee pour suivi manuel.',
    tone: 'red'
  },
  {
    name: 'payout.paid',
    category: 'Versement',
    impact: 'Confirme les versements Stripe vers le compte bancaire.',
    tone: 'blue'
  },
  {
    name: 'payout.failed',
    category: 'Alerte',
    impact: 'Signale un versement bloque qui demande une verification.',
    tone: 'red'
  },
  {
    name: 'payment_intent.payment_failed',
    category: 'Erreur',
    impact:
      'Aide a diagnostiquer les paiements refuses sans exposer les donnees sensibles.',
    tone: 'red'
  }
];

export const WEBHOOK_COMMANDS: readonly DevToolsCommand[] = [
  {
    label: 'Ecouter Stripe',
    value: 'stripe listen --forward-to localhost:3333/api/stripe/webhook'
  },
  {
    label: 'Contribution',
    value: 'stripe trigger payment_intent.succeeded'
  },
  {
    label: 'Session checkout',
    value: 'stripe trigger checkout.session.completed'
  },
  {
    label: 'Session expiree',
    value: 'stripe trigger checkout.session.expired'
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
    label: 'Versement',
    value: 'stripe trigger payout.paid'
  }
];

export const WEBHOOK_DIAGNOSTICS: readonly WebhookDiagnostic[] = [
  {
    time: '10:42',
    event: 'payment_intent.succeeded',
    result: 'Traite',
    impact: 'Contribution ajoutee aux totaux publics.',
    tone: 'ok'
  },
  {
    time: '10:39',
    event: 'charge.refunded',
    result: 'Traite',
    impact: 'Remboursement comptabilise sans donnees personnelles.',
    tone: 'ok'
  },
  {
    time: '10:31',
    event: 'payout.failed',
    result: 'A surveiller',
    impact: 'Versement marque pour verification manuelle.',
    tone: 'warn'
  },
  {
    time: '10:20',
    event: 'signature_verification_failed',
    result: 'Rejete',
    impact: 'Secret webhook invalide ou payload non fiable.',
    tone: 'error'
  }
];

export function webhooksTransparencySourceLabel(
  source: StripeSetupDevStatus['transparencySource']
): string {
  if (source === 'database') {
    return 'PostgreSQL';
  }

  if (source === 'stripe') {
    return 'Stripe direct';
  }

  return 'A configurer';
}
