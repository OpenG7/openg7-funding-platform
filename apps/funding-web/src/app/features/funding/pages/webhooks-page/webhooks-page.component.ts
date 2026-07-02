import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import {
  StripeSetupDevService,
  StripeSetupDevStatus
} from '../../services/stripe-setup-dev.service.js';

interface WebhookEvent {
  readonly name: string;
  readonly category: string;
  readonly impact: string;
  readonly tone: 'green' | 'gold' | 'blue' | 'red';
}

interface WebhookCommand {
  readonly label: string;
  readonly value: string;
}

interface WebhookDiagnostic {
  readonly time: string;
  readonly event: string;
  readonly result: string;
  readonly impact: string;
  readonly tone: 'ok' | 'warn' | 'error';
}

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
  selector: 'openg7-webhooks-page',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="webhooks-shell">
      <aside class="admin-sidebar" aria-label="Navigation Webhooks Stripe">
        <a class="dragon-brand" href="/" aria-label="Accueil OpenG7">
          <span aria-hidden="true">♛</span>
          <div>
            <strong>NorthDragon</strong>
            <em>OpenG7</em>
          </div>
          <small>v2.4.0</small>
        </a>

        <section>
          <h2>Financement</h2>
          <nav aria-label="Menu financement">
            <a href="/">⌂ <span>Tableau de bord</span></a>
            <a href="/fonds-des-batisseurs/transparence">◉ <span>Transparence</span></a>
          </nav>
        </section>

        <section>
          <h2>Stripe</h2>
          <nav aria-label="Menu Stripe">
            <a href="/dev/stripe-setup">$ <span>Stripe Setup</span></a>
            <a class="active" href="/dev/webhooks">♙ <span>Webhooks</span></a>
            <a href="/dev/api-keys">⚿ <span>Cles API</span></a>
          </nav>
        </section>

        <section>
          <h2>Aide</h2>
          <nav aria-label="Menu aide">
            <a href="/support">◎ <span>Support</span></a>
          </nav>
        </section>

        <footer>
          <span aria-hidden="true">◉</span>
          <div>
            <strong>NorthDragon Crew</strong>
            <em>Administrateur</em>
          </div>
        </footer>
      </aside>

      <section class="webhooks-workspace">
        <header class="admin-topbar">
          <nav aria-label="Fil d'Ariane">
            <span>Financement</span>
            <b aria-hidden="true">›</b>
            <strong>Webhooks</strong>
          </nav>
          <div>
            <button type="button" aria-label="Securite">◈</button>
            <button type="button" aria-label="Documentation">▤</button>
            <button type="button" aria-label="Notifications">◔</button>
            <span class="admin-user">Maitre du Dragon <small>Administrateur</small></span>
          </div>
        </header>

        <section class="webhooks-hero" aria-labelledby="webhooks-title">
          <img
            src="assets/openg7-stripe-setup-dragon-banner.png"
            alt="Dragon gardien des flux Webhooks Stripe"
          />
          <div class="hero-copy">
            <span aria-hidden="true">♙</span>
            <div>
              <h1 id="webhooks-title">/dev/webhooks</h1>
              <p>Surveillez, testez et securisez les evenements Stripe qui alimentent la transparence du Fonds.</p>
            </div>
          </div>
        </section>

        <section class="webhook-kpis" aria-label="Statut Webhooks">
          <article [class.ok]="status().apiReachable">
            <span aria-hidden="true">↔</span>
            <div>
              <h2>API locale</h2>
              <strong>{{ status().apiReachable ? 'Joignable' : 'A verifier' }}</strong>
              <p>{{ status().localApiBaseUrl }}</p>
            </div>
          </article>
          <article [class.ok]="status().stripeWebhookSecretConfigured">
            <span aria-hidden="true">◈</span>
            <div>
              <h2>Secret webhook</h2>
              <strong>{{ status().stripeWebhookSecretConfigured ? 'Configure' : 'Manquant' }}</strong>
              <p>whsec_********************************</p>
            </div>
          </article>
          <article [class.ok]="status().databaseReachable">
            <span aria-hidden="true">▦</span>
            <div>
              <h2>Impact transparence</h2>
              <strong>{{ status().databaseReachable ? 'Pret' : 'Base a verifier' }}</strong>
              <p>{{ status().publicTransparencyEndpoint }}</p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">◷</span>
            <div>
              <h2>Derniere verification</h2>
              <strong>{{ status().environment }}</strong>
              <p>{{ status().lastCheckedAt }}</p>
            </div>
          </article>
        </section>

        <section class="webhook-grid">
          <article class="panel endpoint-panel">
            <h2>Endpoint local</h2>
            <p>L'URL ci-dessous recoit les evenements Stripe et les transforme en mouvements financiers agreges.</p>
            <label>
              URL d'endpoint
              <span>
                <code>{{ status().webhookEndpoint }}</code>
                <button type="button" (click)="copyText(status().webhookEndpoint)">Copier</button>
              </span>
            </label>
            <div class="panel-actions">
              <button type="button" (click)="openUrl(status().stripeDashboardUrl)">Ouvrir Stripe Dashboard ↗</button>
              <button type="button" (click)="refreshStatus()">Revalider l'API</button>
            </div>
          </article>

          <article class="panel event-panel">
            <h2>Evenements ecoutes</h2>
            <div class="event-list">
              <article *ngFor="let event of events" [class]="event.tone">
                <span>{{ event.category }}</span>
                <strong>{{ event.name }}</strong>
                <p>{{ event.impact }}</p>
              </article>
            </div>
          </article>

          <article class="panel command-panel">
            <h2>Console de test</h2>
            <p>Copiez ces commandes dans un terminal Stripe CLI local.</p>
            <article *ngFor="let command of commands">
              <span>{{ command.label }}</span>
              <code>{{ command.value }}</code>
              <button type="button" (click)="copyText(command.value)">Copier</button>
            </article>
          </article>

          <article class="panel security-panel">
            <h2>Checklist securite</h2>
            <ul>
              <li>Verifier la signature Stripe sur chaque evenement.</li>
              <li>Ne jamais exposer la valeur whsec_ dans le navigateur.</li>
              <li>Limiter les evenements aux besoins reels de la transparence.</li>
              <li>Journaliser les erreurs sans donnees personnelles.</li>
              <li>Utiliser HTTPS et un endpoint dedie en production.</li>
            </ul>
          </article>
        </section>

        <section class="diagnostic-panel" aria-labelledby="diagnostics-title">
          <header>
            <h2 id="diagnostics-title">Journal de diagnostics</h2>
            <button type="button" (click)="refreshStatus()">Actualiser</button>
          </header>
          <div class="diagnostic-table">
            <article *ngFor="let row of diagnostics" [class]="row.tone">
              <span>{{ row.time }}</span>
              <strong>{{ row.event }}</strong>
              <em>{{ row.result }}</em>
              <p>{{ row.impact }}</p>
            </article>
          </div>
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        background: #020203;
        color: #f6efe2;
        display: block;
        font-family: 'Trebuchet MS', sans-serif;
        min-height: 100dvh;
      }

      h1,
      h2,
      p,
      ul {
        margin: 0;
      }

      button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }

      code {
        font-family: 'Cascadia Code', Consolas, monospace;
      }

      .webhooks-shell {
        background:
          radial-gradient(circle at 82% 0%, rgb(32 170 214 / 14%), transparent 34rem),
          linear-gradient(180deg, #090706 0%, #030303 100%);
        display: block;
        min-height: 100dvh;
        position: relative;
      }

      .admin-sidebar {
        background:
          linear-gradient(180deg, rgb(11 10 10 / 92%), rgb(6 6 6 / 96%)),
          radial-gradient(circle at 50% 0%, rgb(205 126 43 / 12%), transparent 22rem);
        border: 1px solid rgb(194 129 56 / 42%);
        border-left-color: rgb(194 129 56 / 70%);
        display: grid;
        grid-template-rows: auto auto auto 1fr auto;
        inset: 0 auto 0 0;
        min-height: 100dvh;
        overflow-y: auto;
        padding: 1.35rem 0.9rem;
        position: fixed;
        width: 16rem;
        z-index: 10;
      }

      .dragon-brand,
      .admin-sidebar a,
      .admin-sidebar footer {
        align-items: center;
        color: #d9cfbd;
        display: flex;
        gap: 0.75rem;
        text-decoration: none;
      }

      .dragon-brand {
        color: #ffe1a0;
        margin-bottom: 1.8rem;
      }

      .dragon-brand > span {
        border: 1px solid rgb(222 160 72 / 70%);
        border-radius: 0.75rem;
        color: #ffcf65;
        display: grid;
        font-size: 2.1rem;
        height: 3.2rem;
        place-items: center;
        width: 3.2rem;
      }

      .dragon-brand strong {
        display: block;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.55rem;
        line-height: 0.95;
      }

      .dragon-brand em,
      .dragon-brand small,
      .admin-sidebar footer em {
        color: #c89d57;
        display: block;
        font-style: normal;
      }

      .dragon-brand small {
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 999px;
        color: #d8c9ae;
        font-size: 0.65rem;
        padding: 0.1rem 0.35rem;
      }

      .admin-sidebar nav {
        display: grid;
        gap: 0.3rem;
      }

      .admin-sidebar section {
        margin-top: 1.15rem;
      }

      .admin-sidebar h2 {
        color: #c58a36;
        font-size: 0.78rem;
        letter-spacing: 0.06em;
        margin: 0 0 0.5rem 0.25rem;
        text-transform: uppercase;
      }

      .admin-sidebar a {
        border: 1px solid transparent;
        border-radius: 0.45rem;
        min-height: 2.75rem;
        padding: 0 0.65rem;
      }

      .admin-sidebar a.active {
        background: linear-gradient(90deg, rgb(44 195 255 / 22%), rgb(44 195 255 / 5%));
        border-color: rgb(68 208 255 / 70%);
        box-shadow: inset 0 0 22px rgb(68 208 255 / 14%), 0 0 18px rgb(68 208 255 / 15%);
        color: #d5f7ff;
      }

      .admin-sidebar footer {
        background: rgb(8 8 8 / 82%);
        border: 1px solid rgb(194 129 56 / 35%);
        border-radius: 0.65rem;
        margin-top: 2rem;
        padding: 0.75rem;
      }

      .admin-sidebar footer > span {
        border: 1px solid rgb(194 129 56 / 52%);
        border-radius: 999px;
        display: grid;
        height: 2.4rem;
        place-items: center;
        width: 2.4rem;
      }

      .admin-sidebar footer strong {
        display: block;
        font-size: 0.8rem;
      }

      .webhooks-workspace {
        background:
          radial-gradient(circle at 88% 0%, rgb(32 170 214 / 16%), transparent 34rem),
          linear-gradient(180deg, rgb(9 9 10 / 96%), rgb(3 3 4 / 100%));
        margin-left: 16rem;
        min-height: 100dvh;
        padding: 0.75rem 1.1rem 1rem;
        position: relative;
      }

      .admin-topbar {
        align-items: center;
        border-bottom: 1px solid rgb(194 129 56 / 20%);
        display: flex;
        justify-content: space-between;
        min-height: 3rem;
      }

      .admin-topbar nav,
      .admin-topbar div {
        align-items: center;
        display: flex;
        gap: 0.75rem;
      }

      .admin-topbar span,
      .admin-topbar b,
      .admin-topbar strong,
      .admin-user small {
        color: #c5a56c;
      }

      .admin-topbar button {
        background: transparent;
        color: #d6b574;
        min-height: 2rem;
      }

      .admin-user {
        color: #f6efe2;
        font-size: 0.82rem;
        text-align: right;
      }

      .admin-user small {
        display: block;
      }

      .webhooks-hero {
        min-height: 12rem;
        overflow: hidden;
        position: relative;
      }

      .webhooks-hero img {
        filter: saturate(1.1) contrast(1.08);
        height: 100%;
        inset: 0;
        object-fit: cover;
        object-position: center center;
        position: absolute;
        width: 100%;
      }

      .webhooks-hero::after {
        background:
          linear-gradient(90deg, rgb(6 5 5 / 94%) 0%, rgb(6 5 5 / 70%) 38%, rgb(6 5 5 / 12%) 72%, rgb(6 5 5 / 34%) 100%),
          linear-gradient(180deg, rgb(6 5 5 / 0%), rgb(6 5 5 / 78%));
        content: '';
        inset: 0;
        position: absolute;
      }

      .hero-copy {
        align-items: center;
        display: flex;
        gap: 1rem;
        padding: 3.4rem clamp(1rem, 4vw, 4rem) 1rem;
        position: relative;
        z-index: 1;
      }

      .hero-copy > span {
        color: #48d9ff;
        font-size: 3rem;
        text-shadow: 0 0 24px rgb(72 217 255 / 45%);
      }

      .hero-copy h1 {
        color: #dff9ff;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.3rem, 4vw, 3.6rem);
        line-height: 0.96;
      }

      .hero-copy p {
        color: #cfc1ad;
        font-size: 0.95rem;
        line-height: 1.35;
        margin-top: 0.55rem;
        max-width: 40rem;
      }

      .webhook-kpis,
      .webhook-grid {
        display: grid;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }

      .webhook-kpis {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .webhook-kpis article,
      .panel,
      .diagnostic-panel {
        background: linear-gradient(180deg, rgb(25 25 27 / 88%), rgb(12 12 13 / 92%));
        border: 1px solid rgb(73 181 230 / 28%);
        border-radius: 0.72rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%), 0 18px 40px rgb(0 0 0 / 28%);
        min-width: 0;
        padding: 0.85rem;
      }

      .webhook-kpis article {
        align-items: center;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: auto 1fr;
      }

      .webhook-kpis article.ok {
        border-color: rgb(80 229 111 / 35%);
      }

      .webhook-kpis article > span {
        border: 1px solid rgb(72 217 255 / 48%);
        border-radius: 999px;
        color: #62ddff;
        display: grid;
        font-size: 1.2rem;
        height: 2.5rem;
        place-items: center;
        width: 2.5rem;
      }

      .webhook-kpis h2,
      .panel h2,
      .diagnostic-panel h2 {
        color: #f4eadb;
        font-size: 0.82rem;
        letter-spacing: 0.05em;
        margin-bottom: 0.45rem;
        text-transform: uppercase;
      }

      .webhook-kpis strong {
        color: #dff9ff;
        display: block;
      }

      .webhook-kpis p,
      .panel p,
      .panel label,
      .security-panel li,
      .diagnostic-table p {
        color: #b9ad9e;
        font-size: 0.75rem;
        line-height: 1.35;
      }

      .webhook-grid {
        grid-template-columns: minmax(20rem, 0.95fr) minmax(25rem, 1.25fr) minmax(21rem, 1fr);
      }

      .endpoint-panel,
      .command-panel,
      .security-panel {
        display: grid;
        gap: 0.7rem;
      }

      .event-panel {
        grid-row: span 2;
      }

      .endpoint-panel label span {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: minmax(0, 1fr) auto;
        margin-top: 0.35rem;
      }

      code {
        background: rgb(11 11 12 / 92%);
        border: 1px solid rgb(255 255 255 / 10%);
        border-radius: 0.42rem;
        color: #d7c7ae;
        overflow: auto;
        padding: 0.6rem;
        white-space: nowrap;
      }

      .panel button,
      .diagnostic-panel button {
        background: rgb(25 23 22 / 90%);
        border: 1px solid rgb(73 181 230 / 34%);
        border-radius: 0.45rem;
        color: #c6efff;
        min-height: 2.15rem;
        padding: 0 0.7rem;
      }

      .panel-actions {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .event-list {
        display: grid;
        gap: 0.55rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .event-list article {
        background: rgb(8 20 30 / 72%);
        border: 1px solid rgb(73 181 230 / 22%);
        border-radius: 0.55rem;
        padding: 0.62rem;
      }

      .event-list article.green {
        border-color: rgb(87 229 119 / 32%);
      }

      .event-list article.gold {
        border-color: rgb(244 201 87 / 32%);
      }

      .event-list article.red {
        border-color: rgb(255 95 124 / 35%);
      }

      .event-list span,
      .diagnostic-table span {
        color: #6be2ff;
        font-size: 0.66rem;
        text-transform: uppercase;
      }

      .event-list strong {
        color: #f4eadb;
        display: block;
        font-size: 0.86rem;
        margin-top: 0.18rem;
      }

      .event-list p {
        margin-top: 0.3rem;
      }

      .command-panel article {
        display: grid;
        gap: 0.45rem;
        grid-template-columns: minmax(7rem, auto) minmax(0, 1fr) auto;
        align-items: center;
      }

      .command-panel article span {
        color: #d9c49d;
        font-size: 0.78rem;
      }

      .security-panel ul {
        display: grid;
        gap: 0.45rem;
        padding-left: 1rem;
      }

      .diagnostic-panel {
        margin-top: 0.75rem;
      }

      .diagnostic-panel header {
        align-items: center;
        display: flex;
        justify-content: space-between;
      }

      .diagnostic-table {
        display: grid;
        gap: 0.45rem;
        margin-top: 0.65rem;
      }

      .diagnostic-table article {
        align-items: center;
        border-top: 1px solid rgb(255 255 255 / 8%);
        display: grid;
        gap: 0.6rem;
        grid-template-columns: 6rem minmax(16rem, 1fr) minmax(9rem, auto) minmax(14rem, 1fr);
        min-height: 2.8rem;
      }

      .diagnostic-table strong {
        color: #f4eadb;
      }

      .diagnostic-table em {
        font-style: normal;
      }

      .diagnostic-table article.ok em {
        color: #62e97b;
      }

      .diagnostic-table article.warn em {
        color: #f4c957;
      }

      .diagnostic-table article.error em {
        color: #ff6d8d;
      }

      @media (max-width: 1200px) {
        .webhook-kpis,
        .webhook-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .event-panel {
          grid-row: auto;
        }

        .diagnostic-table article {
          grid-template-columns: 1fr;
          padding: 0.6rem 0;
        }
      }

      @media (max-width: 900px) {
        .admin-sidebar {
          inset: auto;
          min-height: auto;
          position: relative;
          width: auto;
        }

        .webhooks-workspace {
          margin-left: 0;
          padding: 0.75rem;
        }

        .admin-topbar,
        .admin-topbar div,
        .hero-copy {
          align-items: flex-start;
          flex-direction: column;
        }

        .webhook-kpis,
        .webhook-grid,
        .event-list,
        .panel-actions,
        .command-panel article,
        .endpoint-panel label span {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class WebhooksPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(fallbackStatus);
  readonly loadError = signal<boolean>(false);

  readonly events: readonly WebhookEvent[] = [
    {
      name: 'checkout.session.completed',
      category: 'Contribution',
      impact: 'Confirme une session de paiement et prepare la contribution publique.',
      tone: 'green'
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
      impact: 'Aide a diagnostiquer les paiements refuses sans exposer les donnees sensibles.',
      tone: 'red'
    }
  ];

  readonly commands: readonly WebhookCommand[] = [
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
      label: 'Remboursement',
      value: 'stripe trigger charge.refunded'
    },
    {
      label: 'Versement',
      value: 'stripe trigger payout.paid'
    }
  ];

  readonly diagnostics: readonly WebhookDiagnostic[] = [
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

  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async copyText(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }
}