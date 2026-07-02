import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import {
  StripeSetupDevService,
  StripeSetupDevStatus
} from '../../services/stripe-setup-dev.service.js';

interface KeyCard {
  readonly title: string;
  readonly maskedValue: string;
  readonly statusLabel: string;
  readonly configured: boolean;
  readonly command: string;
  readonly icon: string;
}

interface PermissionRow {
  readonly name: string;
  readonly read: boolean;
  readonly write: boolean;
  readonly required: boolean;
}

interface RotationStep {
  readonly title: string;
  readonly detail: string;
}

interface AuditRow {
  readonly time: string;
  readonly event: string;
  readonly status: string;
  readonly detail: string;
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
  selector: 'openg7-api-keys-page',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="api-keys-shell">
      <aside class="admin-sidebar" aria-label="Navigation Cles API Stripe">
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
            <a href="/dev/webhooks">♙ <span>Webhooks</span></a>
            <a class="active" href="/dev/api-keys">⚿ <span>Cles API</span></a>
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

      <section class="api-workspace">
        <header class="admin-topbar">
          <nav aria-label="Fil d'Ariane">
            <span>Financement</span>
            <b aria-hidden="true">›</b>
            <strong>Cles API</strong>
          </nav>
          <div>
            <button type="button" aria-label="Securite">◈</button>
            <button type="button" aria-label="Documentation">▤</button>
            <button type="button" aria-label="Notifications">◔</button>
            <span class="admin-user">Maitre du Dragon <small>Administrateur</small></span>
          </div>
        </header>

        <section class="api-hero" aria-labelledby="api-keys-title">
          <img
            src="assets/openg7-stripe-setup-dragon-banner.png"
            alt="Dragon gardien des cles Stripe"
          />
          <div class="hero-copy">
            <span aria-hidden="true">⚿</span>
            <div>
              <h1 id="api-keys-title">/dev/api-keys</h1>
              <p>Gerez les cles Stripe utilisees par la funding-platform sans exposer les secrets dans le navigateur.</p>
            </div>
          </div>
        </section>

        <section class="key-status-grid" aria-label="Etat des cles Stripe">
          <article *ngFor="let key of keyCards()" [class.ok]="key.configured">
            <span aria-hidden="true">{{ key.icon }}</span>
            <div>
              <h2>{{ key.title }}</h2>
              <strong>{{ key.statusLabel }}</strong>
              <code>{{ key.maskedValue }}</code>
              <button type="button" (click)="copyText(key.command)">Copier la commande</button>
            </div>
          </article>
        </section>

        <section class="api-grid">
          <article class="panel rotation-panel">
            <h2>Rotation securisee</h2>
            <ol>
              <li *ngFor="let step of rotationSteps; let index = index">
                <span>{{ index + 1 }}</span>
                <div>
                  <strong>{{ step.title }}</strong>
                  <p>{{ step.detail }}</p>
                </div>
              </li>
            </ol>
          </article>

          <article class="panel permission-panel">
            <h2>Permissions recommandees</h2>
            <div class="permission-table">
              <article *ngFor="let permission of permissions">
                <strong>{{ permission.name }}</strong>
                <span [class.enabled]="permission.read">Lecture</span>
                <span [class.enabled]="permission.write">Ecriture</span>
                <em [class.required]="permission.required">{{ permission.required ? 'Necessaire' : 'Optionnelle' }}</em>
              </article>
            </div>
          </article>

          <article class="panel command-panel">
            <h2>Commandes copiables</h2>
            <article>
              <span>Cle secrete</span>
              <code>$env:STRIPE_SECRET_KEY="sk_test_REMPLACE_MOI"</code>
              <button type="button" (click)="copyText('$env:STRIPE_SECRET_KEY=&quot;sk_test_REMPLACE_MOI&quot;')">Copier</button>
            </article>
            <article>
              <span>Webhook secret</span>
              <code>$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"</code>
              <button type="button" (click)="copyText('$env:STRIPE_WEBHOOK_SECRET=&quot;whsec_REMPLACE_MOI&quot;')">Copier</button>
            </article>
            <article>
              <span>API locale</span>
              <code>corepack yarn dev:api</code>
              <button type="button" (click)="copyText('corepack yarn dev:api')">Copier</button>
            </article>
            <article>
              <span>Web local</span>
              <code>corepack yarn dev:funding-web</code>
              <button type="button" (click)="copyText('corepack yarn dev:funding-web')">Copier</button>
            </article>
          </article>

          <article class="panel checklist-panel">
            <h2>Checklist securite</h2>
            <ul>
              <li>Ne pas stocker de secret dans Angular.</li>
              <li>Ne jamais committer de fichier .env.</li>
              <li>Restreindre les permissions Stripe au minimum.</li>
              <li>Faire tourner les cles apres incident.</li>
              <li>Verifier les logs Stripe apres rotation.</li>
              <li>Utiliser des cles test en developpement.</li>
            </ul>
          </article>
        </section>

        <section class="audit-panel" aria-labelledby="audit-title">
          <header>
            <h2 id="audit-title">Journal d'audit</h2>
            <button type="button" (click)="refreshStatus()">Revalider</button>
          </header>
          <div>
            <article *ngFor="let row of auditRows" [class]="row.tone">
              <span>{{ row.time }}</span>
              <strong>{{ row.event }}</strong>
              <em>{{ row.status }}</em>
              <p>{{ row.detail }}</p>
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
      ol,
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

      .api-keys-shell {
        background:
          radial-gradient(circle at 82% 0%, rgb(82 210 138 / 14%), transparent 34rem),
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
        background: linear-gradient(90deg, rgb(82 210 138 / 22%), rgb(82 210 138 / 5%));
        border-color: rgb(98 231 152 / 70%);
        box-shadow: inset 0 0 22px rgb(98 231 152 / 14%), 0 0 18px rgb(98 231 152 / 15%);
        color: #dcffe7;
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

      .api-workspace {
        background:
          radial-gradient(circle at 88% 0%, rgb(82 210 138 / 16%), transparent 34rem),
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

      .api-hero {
        min-height: 12rem;
        overflow: hidden;
        position: relative;
      }

      .api-hero img {
        filter: saturate(1.08) contrast(1.08);
        height: 100%;
        inset: 0;
        object-fit: cover;
        object-position: center center;
        position: absolute;
        width: 100%;
      }

      .api-hero::after {
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
        color: #68eca2;
        font-size: 3rem;
        text-shadow: 0 0 24px rgb(104 236 162 / 45%);
      }

      .hero-copy h1 {
        color: #e4ffeb;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.3rem, 4vw, 3.6rem);
        line-height: 0.96;
      }

      .hero-copy p {
        color: #cfc1ad;
        font-size: 0.95rem;
        line-height: 1.35;
        margin-top: 0.55rem;
        max-width: 42rem;
      }

      .key-status-grid,
      .api-grid {
        display: grid;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }

      .key-status-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .key-status-grid article,
      .panel,
      .audit-panel {
        background: linear-gradient(180deg, rgb(25 25 27 / 88%), rgb(12 12 13 / 92%));
        border: 1px solid rgb(91 220 146 / 26%);
        border-radius: 0.72rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%), 0 18px 40px rgb(0 0 0 / 28%);
        min-width: 0;
        padding: 0.85rem;
      }

      .key-status-grid article {
        align-items: start;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: auto 1fr;
      }

      .key-status-grid article.ok {
        border-color: rgb(98 231 152 / 48%);
      }

      .key-status-grid article > span {
        border: 1px solid rgb(104 236 162 / 48%);
        border-radius: 999px;
        color: #68eca2;
        display: grid;
        font-size: 1.2rem;
        height: 2.5rem;
        place-items: center;
        width: 2.5rem;
      }

      .key-status-grid h2,
      .panel h2,
      .audit-panel h2 {
        color: #f4eadb;
        font-size: 0.82rem;
        letter-spacing: 0.05em;
        margin-bottom: 0.45rem;
        text-transform: uppercase;
      }

      .key-status-grid strong {
        color: #e4ffeb;
        display: block;
      }

      .key-status-grid code,
      .command-panel code {
        background: rgb(11 11 12 / 92%);
        border: 1px solid rgb(255 255 255 / 10%);
        border-radius: 0.42rem;
        color: #d7c7ae;
        display: block;
        margin: 0.45rem 0;
        overflow: auto;
        padding: 0.58rem;
        white-space: nowrap;
      }

      .key-status-grid button,
      .panel button,
      .audit-panel button {
        background: rgb(25 23 22 / 90%);
        border: 1px solid rgb(91 220 146 / 34%);
        border-radius: 0.45rem;
        color: #dcffe7;
        min-height: 2.15rem;
        padding: 0 0.7rem;
      }

      .api-grid {
        grid-template-columns: minmax(20rem, 1fr) minmax(24rem, 1.15fr) minmax(22rem, 1fr);
      }

      .rotation-panel,
      .command-panel,
      .checklist-panel {
        display: grid;
        gap: 0.7rem;
      }

      .permission-panel {
        grid-row: span 2;
      }

      .rotation-panel ol {
        display: grid;
        gap: 0.65rem;
        list-style: none;
        padding: 0;
      }

      .rotation-panel li {
        align-items: start;
        display: grid;
        gap: 0.6rem;
        grid-template-columns: auto 1fr;
      }

      .rotation-panel li > span {
        border: 1px solid rgb(104 236 162 / 44%);
        border-radius: 999px;
        color: #68eca2;
        display: grid;
        height: 1.8rem;
        place-items: center;
        width: 1.8rem;
      }

      .rotation-panel strong,
      .permission-table strong,
      .audit-panel strong {
        color: #f4eadb;
      }

      .rotation-panel p,
      .checklist-panel li,
      .audit-panel p {
        color: #b9ad9e;
        font-size: 0.75rem;
        line-height: 1.35;
      }

      .permission-table {
        display: grid;
        gap: 0.5rem;
      }

      .permission-table article {
        align-items: center;
        border-top: 1px solid rgb(255 255 255 / 8%);
        display: grid;
        gap: 0.5rem;
        grid-template-columns: minmax(10rem, 1fr) auto auto auto;
        min-height: 2.7rem;
      }

      .permission-table span,
      .permission-table em {
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 999px;
        color: #968d80;
        font-size: 0.68rem;
        font-style: normal;
        padding: 0.14rem 0.45rem;
      }

      .permission-table span.enabled,
      .permission-table em.required {
        border-color: rgb(104 236 162 / 42%);
        color: #68eca2;
      }

      .command-panel article {
        align-items: center;
        display: grid;
        gap: 0.45rem;
        grid-template-columns: minmax(7rem, auto) minmax(0, 1fr) auto;
      }

      .command-panel span,
      .audit-panel span {
        color: #d9c49d;
        font-size: 0.78rem;
      }

      .checklist-panel ul {
        display: grid;
        gap: 0.45rem;
        padding-left: 1rem;
      }

      .audit-panel {
        margin-top: 0.75rem;
      }

      .audit-panel header {
        align-items: center;
        display: flex;
        justify-content: space-between;
      }

      .audit-panel > div {
        display: grid;
        gap: 0.45rem;
        margin-top: 0.65rem;
      }

      .audit-panel article {
        align-items: center;
        border-top: 1px solid rgb(255 255 255 / 8%);
        display: grid;
        gap: 0.6rem;
        grid-template-columns: 6rem minmax(16rem, 1fr) minmax(9rem, auto) minmax(14rem, 1fr);
        min-height: 2.8rem;
      }

      .audit-panel em {
        font-style: normal;
      }

      .audit-panel article.ok em {
        color: #68eca2;
      }

      .audit-panel article.warn em {
        color: #f4c957;
      }

      .audit-panel article.error em {
        color: #ff6d8d;
      }

      @media (max-width: 1500px) {
        .admin-sidebar {
          align-items: center;
          display: grid;
          gap: 0.55rem 1rem;
          grid-template-columns: auto minmax(0, 1fr);
          inset: auto;
          min-height: auto;
          overflow: visible;
          padding: 0.7rem 1rem;
          position: relative;
          width: auto;
        }

        .dragon-brand {
          margin-bottom: 0;
        }

        .dragon-brand > span {
          border-radius: 0.55rem;
          font-size: 1.35rem;
          height: 2.2rem;
          width: 2.2rem;
        }

        .dragon-brand strong {
          font-size: 1.05rem;
        }

        .dragon-brand em,
        .dragon-brand small {
          font-size: 0.68rem;
        }

        .admin-sidebar section:first-of-type,
        .admin-sidebar section:nth-of-type(2) {
          grid-column: 1 / -1;
          margin-top: 0;
        }

        .admin-sidebar section:first-of-type nav,
        .admin-sidebar section:nth-of-type(2) nav {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .admin-sidebar section:first-of-type h2,
        .admin-sidebar section:nth-of-type(2) h2 {
          margin-top: 0.15rem;
        }

        .admin-sidebar section:nth-of-type(3),
        .admin-sidebar footer {
          display: none;
        }

        .admin-sidebar a {
          min-height: 2rem;
          padding: 0 0.55rem;
        }

        .api-workspace {
          margin-left: 0;
        }
      }

      @media (max-width: 1200px) {
        .key-status-grid,
        .api-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .permission-panel {
          grid-row: auto;
        }

        .audit-panel article {
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

        .api-workspace {
          margin-left: 0;
          padding: 0.75rem;
        }

        .admin-topbar,
        .admin-topbar div,
        .hero-copy {
          align-items: flex-start;
          flex-direction: column;
        }

        .key-status-grid,
        .api-grid,
        .permission-table article,
        .command-panel article {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 700px) {
        .admin-sidebar {
          gap: 0.35rem;
          grid-template-columns: 1fr;
          padding: 0.45rem 0.65rem;
        }

        .dragon-brand {
          gap: 0.45rem;
        }

        .dragon-brand > span {
          font-size: 1rem;
          height: 1.75rem;
          width: 1.75rem;
        }

        .dragon-brand strong {
          font-size: 0.9rem;
        }

        .dragon-brand em,
        .dragon-brand small {
          font-size: 0.58rem;
        }

        .admin-sidebar section:first-of-type,
        .admin-sidebar section:nth-of-type(3) {
          display: none;
        }

        .admin-sidebar section:nth-of-type(2) {
          grid-column: 1;
        }

        .admin-sidebar section:nth-of-type(2) h2 {
          display: none;
        }

        .admin-sidebar section:nth-of-type(2) nav {
          gap: 0.3rem;
        }

        .admin-sidebar a {
          font-size: 0.72rem;
          min-height: 1.75rem;
          padding: 0 0.45rem;
        }

        .api-workspace {
          padding: 0.5rem;
        }

        .admin-topbar {
          min-height: 2rem;
        }

        .admin-topbar div {
          display: none;
        }

        .admin-topbar nav {
          font-size: 0.78rem;
          gap: 0.35rem;
        }

        .api-hero {
          min-height: 7.6rem;
        }

        .hero-copy {
          gap: 0.55rem;
          padding: 1.15rem 0.65rem 0.65rem;
        }

        .hero-copy > span {
          font-size: 1.65rem;
        }

        .hero-copy h1 {
          font-size: 1.72rem;
        }

        .hero-copy p {
          font-size: 0.72rem;
          line-height: 1.22;
          margin-top: 0.25rem;
        }

        .key-status-grid,
        .api-grid {
          gap: 0.45rem;
          margin-top: 0.45rem;
        }

        .key-status-grid article,
        .panel,
        .audit-panel {
          padding: 0.6rem;
        }

        .key-status-grid article {
          gap: 0.45rem;
        }

        .key-status-grid article > span {
          font-size: 0.95rem;
          height: 2rem;
          width: 2rem;
        }

        .key-status-grid code {
          padding: 0.42rem;
        }
      }
    `
  ]
})
export class ApiKeysPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(fallbackStatus);
  readonly loadError = signal<boolean>(false);

  readonly rotationSteps: readonly RotationStep[] = [
    {
      title: 'Creer une nouvelle cle restreinte',
      detail: 'Generez la cle dans Stripe avec seulement les permissions necessaires.'
    },
    {
      title: 'Deployer la variable cote API',
      detail: 'Injectez la nouvelle valeur dans le terminal ou le secret manager du backend.'
    },
    {
      title: 'Revalider Stripe Setup',
      detail: 'Verifiez que checkout, webhooks et transparence repondent localement.'
    },
    {
      title: "Revoquer l'ancienne cle",
      detail: 'Supprimez seulement apres validation et surveillance des logs Stripe.'
    }
  ];

  readonly permissions: readonly PermissionRow[] = [
    { name: 'checkout.sessions', read: true, write: true, required: true },
    { name: 'payment_intents', read: true, write: true, required: true },
    { name: 'charges', read: true, write: false, required: true },
    { name: 'refunds', read: true, write: true, required: true },
    { name: 'payouts', read: true, write: false, required: false },
    { name: 'webhook_endpoints', read: true, write: true, required: false }
  ];

  readonly auditRows: readonly AuditRow[] = [
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

  readonly keyCards = () : readonly KeyCard[] => {
    const status = this.status();

    return [
      {
        title: 'Cle publiable',
        maskedValue: 'pk_live_************************',
        statusLabel: 'Utilisable cote client',
        configured: true,
        command: 'pk_live_REMPLACE_MOI',
        icon: '◇'
      },
      {
        title: 'Cle secrete',
        maskedValue: 'sk_live_************************',
        statusLabel: status.stripeSecretKeyConfigured ? 'Configuree cote API' : 'Manquante cote API',
        configured: status.stripeSecretKeyConfigured,
        command: '$env:STRIPE_SECRET_KEY="sk_live_REMPLACE_MOI"',
        icon: '⚿'
      },
      {
        title: 'Secret webhook',
        maskedValue: 'whsec_************************',
        statusLabel: status.stripeWebhookSecretConfigured ? 'Configure cote API' : 'Manquant cote API',
        configured: status.stripeWebhookSecretConfigured,
        command: '$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"',
        icon: '◈'
      },
      {
        title: 'Environnement',
        maskedValue: status.localApiBaseUrl,
        statusLabel: status.apiReachable ? 'API locale joignable' : 'API locale a verifier',
        configured: status.apiReachable,
        command: 'corepack yarn dev:api',
        icon: '◎'
      }
    ];
  };

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

  async copyText(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }
}