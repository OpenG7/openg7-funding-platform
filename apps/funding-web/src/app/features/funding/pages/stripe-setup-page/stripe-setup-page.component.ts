import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';

import {
  StripeSetupDevService,
  StripeSetupDevStatus
} from '../../services/stripe-setup-dev.service.js';

type SetupStepStatus = 'manual' | 'verified' | 'blocked';

interface SetupCommand {
  readonly label: string;
  readonly value: string;
}

interface SetupLink {
  readonly label: string;
  readonly url: string;
}

interface SetupStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: SetupStepStatus;
  readonly statusLabel: string;
  readonly commands: readonly SetupCommand[];
  readonly links: readonly SetupLink[];
  readonly checklist: readonly string[];
}

const storageKey = 'openg7.stripeSetup.completedSteps.v1';

const fallbackStatus: StripeSetupDevStatus = {
  environment: 'development',
  apiReachable: false,
  stripeSecretKeyConfigured: false,
  stripeWebhookSecretConfigured: false,
  databaseUrlConfigured: false,
  databaseReachable: false,
  localApiBaseUrl: 'http://localhost:3333',
  checkoutEndpoint: 'http://localhost:3333/api/checkout-sessions',
  webhookEndpoint: 'http://localhost:3333/api/stripe/webhook',
  publicTransparencyEndpoint: 'http://localhost:3333/api/public/fund-transparency',
  stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
  lastCheckedAt: new Date(0).toISOString()
};

@Component({
  selector: 'openg7-stripe-setup-page',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="setup-shell">
      <section class="setup-hero">
        <div>
          <p class="eyebrow">Configuration locale</p>
          <h1>Stripe pour le Fonds des batisseurs</h1>
          <p>
            Ce guide reste local au poste du developpeur. Il aide a configurer Stripe,
            la base de donnees et le webhook sans exposer les secrets dans le navigateur.
          </p>
        </div>
        <button type="button" class="refresh" (click)="refreshStatus()">
          Revalider
        </button>
      </section>

      <section class="status-grid">
        <article class="status-card" [class.ok]="status().apiReachable">
          <span>API locale</span>
          <strong>{{ status().apiReachable ? 'Joignable' : 'A verifier' }}</strong>
        </article>
        <article class="status-card" [class.ok]="status().stripeSecretKeyConfigured">
          <span>STRIPE_SECRET_KEY</span>
          <strong>{{ status().stripeSecretKeyConfigured ? 'Configuree' : 'Manquante' }}</strong>
        </article>
        <article class="status-card" [class.ok]="status().stripeWebhookSecretConfigured">
          <span>STRIPE_WEBHOOK_SECRET</span>
          <strong>{{ status().stripeWebhookSecretConfigured ? 'Configuree' : 'Manquante' }}</strong>
        </article>
        <article class="status-card" [class.ok]="status().databaseReachable">
          <span>PostgreSQL</span>
          <strong>{{ status().databaseReachable ? 'Connecte' : 'A verifier' }}</strong>
        </article>
      </section>

      <section class="notice">
        <strong>Principe de securite:</strong>
        les boutons ouvrent des pages ou copient des commandes. Le navigateur ne lance pas
        Stripe CLI et ne lit jamais la valeur des secrets.
      </section>

      <ol class="stepper">
        <li
          *ngFor="let step of steps(); let index = index"
          class="step-card"
          [class.done]="isCompleted(step.id) || step.status === 'verified'"
          [class.blocked]="step.status === 'blocked'"
        >
          <div class="step-index">{{ index + 1 }}</div>
          <div class="step-body">
            <header>
              <div>
                <h2>{{ step.title }}</h2>
                <p>{{ step.description }}</p>
              </div>
              <span class="step-status">{{ step.statusLabel }}</span>
            </header>

            <ul class="checklist" *ngIf="step.checklist.length > 0">
              <li *ngFor="let item of step.checklist">{{ item }}</li>
            </ul>

            <div class="commands" *ngIf="step.commands.length > 0">
              <article *ngFor="let command of step.commands" class="command-card">
                <span>{{ command.label }}</span>
                <code>{{ command.value }}</code>
                <button type="button" (click)="copyText(command.value)">Copier</button>
              </article>
            </div>

            <div class="links" *ngIf="step.links.length > 0">
              <article *ngFor="let link of step.links" class="link-card">
                <span>{{ link.label }}</span>
                <code>{{ link.url }}</code>
                <div>
                  <button type="button" (click)="openUrl(link.url)">Ouvrir</button>
                  <button type="button" (click)="copyText(link.url)">Copier</button>
                </div>
              </article>
            </div>

            <button
              type="button"
              class="complete"
              [class.active]="isCompleted(step.id)"
              (click)="toggleCompleted(step.id)"
            >
              {{ isCompleted(step.id) ? 'Etape marquee comme faite' : 'Marquer comme fait' }}
            </button>
          </div>
        </li>
      </ol>

      <footer class="setup-footer">
        <span>Derniere verification: {{ status().lastCheckedAt }}</span>
        <span *ngIf="loadError()">Diagnostic local indisponible. Verifie que yarn dev tourne.</span>
      </footer>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background:
        radial-gradient(circle at 86% 8%, rgba(13, 148, 136, 0.16), transparent 30%),
        radial-gradient(circle at 12% 20%, rgba(180, 83, 9, 0.12), transparent 28%),
        linear-gradient(180deg, #fbfaf7 0%, #eef6f2 100%);
      color: #17231d;
      font-family: 'Aptos', 'Segoe UI', sans-serif;
      padding: 2rem clamp(1rem, 3vw, 2.5rem);
    }

    .setup-shell {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      gap: 1rem;
    }

    .setup-hero,
    .notice,
    .status-card,
    .step-card {
      border: 1px solid rgba(82, 99, 88, 0.18);
      background: rgba(255, 255, 255, 0.86);
      box-shadow: 0 18px 48px rgba(39, 57, 48, 0.1);
      backdrop-filter: blur(10px);
    }

    .setup-hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      border-radius: 18px;
      padding: clamp(1.1rem, 3vw, 2rem);
    }

    .eyebrow {
      margin: 0 0 0.4rem;
      color: #0f766e;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      max-width: 720px;
      font-size: clamp(1.55rem, 4vw, 2.5rem);
      line-height: 1.1;
    }

    .setup-hero p:not(.eyebrow) {
      max-width: 760px;
      margin-top: 0.7rem;
      color: #405246;
      line-height: 1.55;
    }

    button {
      min-height: 2.35rem;
      border: 0;
      border-radius: 10px;
      padding: 0.55rem 0.85rem;
      cursor: pointer;
      font-weight: 700;
      color: #102019;
      background: #dbeee6;
    }

    button:hover {
      background: #c5e4d7;
    }

    .refresh {
      white-space: nowrap;
      color: #fff;
      background: #0f766e;
    }

    .refresh:hover {
      background: #115e59;
    }

    .status-grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .status-card {
      border-radius: 14px;
      padding: 0.9rem;
      display: grid;
      gap: 0.35rem;
    }

    .status-card span {
      color: #58675e;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .status-card strong {
      font-size: 1.05rem;
    }

    .status-card.ok {
      border-color: rgba(20, 135, 90, 0.34);
      background: rgba(236, 253, 245, 0.9);
    }

    .notice {
      border-left: 5px solid #d97706;
      border-radius: 14px;
      padding: 0.9rem 1rem;
      color: #35463c;
      line-height: 1.45;
    }

    .stepper {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.85rem;
    }

    .step-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.9rem;
      border-radius: 16px;
      padding: 1rem;
    }

    .step-card.done {
      border-color: rgba(20, 135, 90, 0.34);
    }

    .step-card.blocked {
      border-color: rgba(185, 28, 28, 0.25);
    }

    .step-index {
      width: 2.2rem;
      height: 2.2rem;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #17352b;
      color: #fff;
      font-weight: 800;
    }

    .step-body {
      display: grid;
      gap: 0.85rem;
    }

    .step-body header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }

    h2 {
      font-size: 1.1rem;
    }

    .step-body header p,
    .checklist {
      margin-top: 0.3rem;
      color: #506256;
      line-height: 1.45;
    }

    .step-status {
      border-radius: 999px;
      background: #eef2ef;
      color: #304238;
      padding: 0.35rem 0.65rem;
      font-size: 0.78rem;
      font-weight: 800;
      white-space: nowrap;
    }

    .checklist {
      margin: 0;
      padding-left: 1.1rem;
    }

    .commands,
    .links {
      display: grid;
      gap: 0.55rem;
    }

    .command-card,
    .link-card {
      display: grid;
      grid-template-columns: minmax(130px, 0.4fr) 1fr auto;
      align-items: center;
      gap: 0.65rem;
      padding: 0.7rem;
      border-radius: 12px;
      background: rgba(238, 246, 242, 0.78);
    }

    .link-card div {
      display: flex;
      gap: 0.45rem;
    }

    code {
      overflow: auto;
      color: #102019;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 8px;
      padding: 0.5rem;
      font-family: 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .complete {
      justify-self: start;
      background: #f0eadc;
    }

    .complete.active {
      color: #fff;
      background: #15803d;
    }

    .setup-footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.7rem;
      color: #506256;
      font-size: 0.9rem;
    }

    @media (max-width: 760px) {
      :host {
        padding: 1rem 0.75rem 1.6rem;
      }

      .setup-hero,
      .step-body header {
        flex-direction: column;
      }

      .step-card {
        grid-template-columns: 1fr;
      }

      .command-card,
      .link-card {
        grid-template-columns: 1fr;
      }

      .link-card div {
        flex-wrap: wrap;
      }
    }
  `
})
export class StripeSetupPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(fallbackStatus);
  readonly completedStepIds = signal<readonly string[]>(this.loadCompletedSteps());
  readonly loadError = signal<boolean>(false);

  readonly steps = computed<readonly SetupStep[]>(() => {
    const status = this.status();

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
        title: 'Preparer PostgreSQL',
        description: 'Configure DATABASE_URL et applique la migration de transparence financiere.',
        status: status.databaseReachable ? 'verified' : 'manual',
        statusLabel: status.databaseReachable ? 'Verifie' : 'A faire',
        checklist: [
          status.databaseUrlConfigured ? 'DATABASE_URL est configuree' : 'DATABASE_URL manque',
          status.databaseReachable ? 'La base repond' : 'La base ne repond pas encore'
        ],
        commands: [
          {
            label: 'Variable',
            value:
              '$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/openg7_funding"'
          },
          {
            label: 'Migration',
            value:
              'psql "$env:DATABASE_URL" -f "apps/funding-api/migrations/001_create_fund_transparency_tables.sql"'
          }
        ],
        links: []
      },
      {
        id: 'stripe-secret',
        title: 'Configurer la cle secrete Stripe',
        description: 'Recupere la cle test dans Stripe et injecte-la seulement dans le terminal API.',
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
        description: 'Connecte Stripe CLI, puis redirige les evenements vers le webhook local.',
        status: 'manual',
        statusLabel: 'Manuel',
        checklist: ['stripe login ouvre le navigateur', 'stripe listen affiche un secret whsec_...'],
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
        description: 'Copie le whsec affiche par Stripe CLI dans la session qui lance le backend.',
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
        title: 'Demarrer le site et l API',
        description: 'Lance le serveur Angular avec le proxy et le backend Stripe local.',
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
            url: 'http://localhost:4200'
          }
        ]
      },
      {
        id: 'test-events',
        title: 'Declencher les evenements test',
        description: 'Envoie les evenements Stripe minimaux pour remplir la transparence publique.',
        status: 'manual',
        statusLabel: 'Commande locale',
        checklist: ['Le terminal stripe listen doit rester ouvert pendant ce test'],
        commands: [
          {
            label: 'Paiement',
            value: 'stripe trigger payment_intent.succeeded'
          },
          {
            label: 'Remboursement',
            value: 'stripe trigger charge.refunded'
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
        description: 'Confirme que l API agregee et la page publique repondent localement.',
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
            url: 'http://localhost:4200/fonds-des-batisseurs/transparence'
          }
        ]
      }
    ];
  });

  async ngOnInit(): Promise<void> {
    await this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    try {
      this.status.set(await this.setupService.getStatus());
      this.loadError.set(false);
    } catch {
      this.status.set(fallbackStatus);
      this.loadError.set(true);
    }
  }

  isCompleted(stepId: string): boolean {
    return this.completedStepIds().includes(stepId);
  }

  toggleCompleted(stepId: string): void {
    const completed = this.completedStepIds();
    const next = completed.includes(stepId)
      ? completed.filter((id) => id !== stepId)
      : [...completed, stepId];

    this.completedStepIds.set(next);
    this.saveCompletedSteps(next);
  }

  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async copyText(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }

  private loadCompletedSteps(): readonly string[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const rawValue = localStorage.getItem(storageKey);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
      ? parsed
      : [];
  }

  private saveCompletedSteps(stepIds: readonly string[]): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(stepIds));
  }
}
