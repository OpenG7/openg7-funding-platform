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
type SetupStageState = 'complete' | 'active' | 'pending';

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

interface SetupStage {
  readonly number: number;
  readonly title: string;
  readonly detail: string;
  readonly state: SetupStageState;
}

interface SecurityCheck {
  readonly label: string;
  readonly state: 'complete' | 'progress';
}

const storageKey = 'openg7.stripeSetup.completedSteps.v1';

const fallbackStatus: StripeSetupDevStatus = {
  environment: 'development',
  apiReachable: false,
  stripeSecretKeyConfigured: false,
  stripeWebhookSecretConfigured: false,
  databaseUrlConfigured: false,
  databaseReachable: false,
  transparencySource: 'none',
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
    <main class="stripe-admin-shell">
      <aside class="admin-sidebar" aria-label="Navigation developpeur Stripe">
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
            <a class="active" href="/dev/stripe-setup">$ <span>Stripe Setup</span></a>
            <a href="/dev/webhooks">♙ <span>Webhooks</span></a>
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

      <section class="admin-workspace">
        <header class="admin-topbar">
          <nav aria-label="Fil d'Ariane">
            <span>Financement</span>
            <b aria-hidden="true">›</b>
            <strong>Stripe Setup</strong>
          </nav>
          <div>
            <button type="button" aria-label="Securite">◈</button>
            <button type="button" aria-label="Documentation">▤</button>
            <button type="button" aria-label="Notifications">◔</button>
            <span class="admin-user">Maitre du Dragon <small>Administrateur</small></span>
          </div>
        </header>

        <section class="setup-hero" aria-labelledby="stripe-setup-title">
          <img
            src="assets/openg7-stripe-setup-dragon-banner.png"
            alt="Dragon NorthDragon gardien de la configuration Stripe"
          />
          <div class="hero-shield" aria-hidden="true">♜</div>
          <div class="hero-copy">
            <span class="dragon-mark" aria-hidden="true">♛</span>
            <div>
              <h1 id="stripe-setup-title">/dev/stripe-setup</h1>
              <p>Connectez et configurez Stripe en toute securite pour accepter des paiements a l'echelle mondiale.</p>
            </div>
          </div>
        </section>

        <ol class="setup-progress" aria-label="Progression Stripe Setup">
          <li *ngFor="let stage of setupStages()" [class.complete]="stage.state === 'complete'" [class.active]="stage.state === 'active'">
            <span>{{ stage.state === 'complete' ? '✓' : stage.number }}</span>
            <div>
              <strong>{{ stage.title }}</strong>
              <em>{{ stage.detail }}</em>
            </div>
          </li>
        </ol>

        <section class="setup-grid top-grid" aria-label="Statuts Stripe">
          <article class="panel account-panel" [class.ok]="status().apiReachable">
            <span class="panel-icon" aria-hidden="true">✓</span>
            <div>
              <h2>Statut de connexion</h2>
              <strong>{{ status().apiReachable ? 'Compte Stripe connecte' : 'Connexion Stripe a verifier' }}</strong>
              <p>Compte : northdragon-openg7</p>
              <p>ID : acct_1NDGR7xxxxxxx</p>
            </div>
            <button type="button" (click)="openUrl(status().stripeDashboardUrl)">Gerer le compte Stripe ↗</button>
          </article>

          <article class="panel mode-panel">
            <h2>Mode actuel</h2>
            <p>Choisissez le mode dans lequel vous souhaitez operer.</p>
            <div class="mode-toggle" role="group" aria-label="Mode Stripe">
              <button type="button" [class.active]="paymentMode() === 'test'" (click)="setPaymentMode('test')">♜ Test</button>
              <button type="button" [class.active]="paymentMode() === 'live'" (click)="setPaymentMode('live')">♨ Live</button>
            </div>
            <aside>
              <strong>Les paiements reels seront traites.</strong>
              <span>Assurez-vous que tout est configure correctement.</span>
            </aside>
          </article>

          <article class="panel keys-panel">
            <h2>Cles API</h2>
            <label>
              Cle publiable
              <span>
                <code>pk_live_********************************</code>
                <button type="button" (click)="copyText('pk_live_REMPLACE_MOI')">Copier</button>
              </span>
            </label>
            <label>
              Cle secrete
              <span>
                <code>sk_live_********************************</code>
                <button type="button" (click)="copyText('$env:STRIPE_SECRET_KEY=&quot;sk_live_REMPLACE_MOI&quot;')">Copier</button>
              </span>
            </label>
            <p>🔒 Vos cles sont chiffrees et stockees en toute securite.</p>
            <button type="button" class="subtle" (click)="openUrl('https://dashboard.stripe.com/test/apikeys')">Generer de nouvelles cles ↻</button>
          </article>

          <article class="panel payout-panel" [class.ok]="status().stripeSecretKeyConfigured">
            <span class="bank-icon" aria-hidden="true">♜</span>
            <h2>Statut des versements</h2>
            <strong>{{ status().stripeSecretKeyConfigured ? 'Versements consultables' : 'Cle Stripe a verifier' }}</strong>
            <p>Compte bancaire : **** 4242</p>
            <p>Devise : CAD</p>
            <button type="button" (click)="openUrl('https://dashboard.stripe.com/test/balance/overview')">Gerer les versements ↗</button>
          </article>
        </section>

        <section class="setup-grid lower-grid" aria-label="Configuration avancee Stripe">
          <article class="panel webhook-panel">
            <header>
              <h2>Webhooks</h2>
              <span [class.ok]="status().stripeWebhookSecretConfigured">{{ status().stripeWebhookSecretConfigured ? 'Actif' : 'A configurer' }}</span>
            </header>
            <label>
              URL d'endpoint
              <span>
                <code>{{ status().webhookEndpoint }}</code>
                <button type="button" (click)="copyText(status().webhookEndpoint)">Copier</button>
              </span>
            </label>
            <div class="event-chips" aria-label="Evenements ecoutes">
              <span>payment_intent.succeeded</span>
              <span>checkout.session.completed</span>
              <span>+6 autres</span>
            </div>
            <div class="panel-actions">
              <button type="button" (click)="openUrl(status().stripeDashboardUrl)">Voir dans Stripe ↗</button>
              <button type="button" (click)="copyText('stripe listen --forward-to localhost:3333/api/stripe/webhook')">Tester l'endpoint</button>
            </div>
          </article>

          <article class="panel security-panel">
            <h2>Liste de controle de securite</h2>
            <ul>
              <li *ngFor="let item of securityChecks()" [class.progress]="item.state === 'progress'">
                <span aria-hidden="true">{{ item.state === 'complete' ? '▣' : '▧' }}</span>
                <strong>{{ item.label }}</strong>
                <em>{{ item.state === 'complete' ? 'Termine' : 'En cours' }}</em>
              </li>
            </ul>
            <button type="button" class="guide" (click)="openUrl('https://docs.stripe.com/security')">Voir le guide de securite ↗</button>
          </article>

          <article class="panel quick-panel">
            <h2>Actions rapides</h2>
            <button type="button" class="danger" (click)="refreshStatus()">◈ Verifier la configuration <span>Verifier</span></button>
            <button type="button" (click)="copyText('corepack yarn dev')">▤ Enregistrer les parametres <span>Enregistrer</span></button>
            <button type="button" class="gold" (click)="setPaymentMode('live')">♛ Activer les paiements <small>Passer en production et accepter des paiements reels.</small></button>
          </article>
        </section>

        <section class="developer-commands" aria-labelledby="commands-title">
          <h2 id="commands-title">Guide developpeur local</h2>
          <ol>
            <li
              *ngFor="let step of steps(); let index = index"
              [class.done]="isCompleted(step.id) || step.status === 'verified'"
              [class.blocked]="step.status === 'blocked'"
            >
              <button type="button" class="command-step" (click)="toggleCompleted(step.id)">
                <span>{{ index + 1 }}</span>
                <strong>{{ step.title }}</strong>
                <em>{{ step.statusLabel }}</em>
              </button>
              <div class="command-detail">
                <p>{{ step.description }}</p>
                <ul *ngIf="step.checklist.length > 0">
                  <li *ngFor="let item of step.checklist">{{ item }}</li>
                </ul>
                <article *ngFor="let command of step.commands">
                  <span>{{ command.label }}</span>
                  <code>{{ command.value }}</code>
                  <button type="button" (click)="copyText(command.value)">Copier</button>
                </article>
                <article *ngFor="let link of step.links">
                  <span>{{ link.label }}</span>
                  <code>{{ link.url }}</code>
                  <button type="button" (click)="openUrl(link.url)">Ouvrir</button>
                  <button type="button" (click)="copyText(link.url)">Copier</button>
                </article>
              </div>
            </li>
          </ol>
        </section>

        <footer class="setup-footer">
          <span>◈ Besoin d'aide ? Consultez notre documentation Stripe ou contactez l'equipe NorthDragon.</span>
          <div>
            <button type="button" (click)="openUrl('https://docs.stripe.com')">Documentation ↗</button>
            <button type="button" (click)="openUrl('/support')">Contacter le support</button>
          </div>
          <small>Derniere verification : {{ status().lastCheckedAt }}</small>
          <small *ngIf="loadError()">Diagnostic local indisponible. Verifiez que yarn dev tourne.</small>
        </footer>
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
      h3,
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

      .stripe-admin-shell {
        background:
          radial-gradient(circle at 82% 0%, rgb(190 99 26 / 18%), transparent 32rem),
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
        overflow-y: auto;
        position: fixed;
        min-height: 100dvh;
        padding: 1.35rem 0.9rem;
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
        background: linear-gradient(90deg, rgb(255 78 119 / 26%), rgb(255 78 119 / 5%));
        border-color: rgb(255 91 125 / 70%);
        box-shadow: inset 0 0 22px rgb(255 79 119 / 16%), 0 0 18px rgb(255 79 119 / 18%);
        color: #ffd2d6;
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

      .admin-workspace {
        background:
          radial-gradient(circle at 88% 0%, rgb(180 88 26 / 18%), transparent 34rem),
          linear-gradient(180deg, rgb(9 9 10 / 96%), rgb(3 3 4 / 100%));
        margin-left: 16rem;
        min-height: 100dvh;
        min-width: 0;
        padding: 0.75rem 1.1rem 1rem;
        position: relative;
        z-index: 1;
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

      .setup-hero {
        min-height: 8.9rem;
        overflow: hidden;
        position: relative;
      }

      .setup-hero img {
        filter: saturate(1.05) contrast(1.08);
        height: 100%;
        inset: 0;
        object-fit: cover;
        object-position: center center;
        position: absolute;
        width: 100%;
      }

      .setup-hero::after {
        background:
          linear-gradient(90deg, rgb(6 5 5 / 94%) 0%, rgb(6 5 5 / 72%) 37%, rgb(6 5 5 / 10%) 72%, rgb(6 5 5 / 24%) 100%),
          linear-gradient(180deg, rgb(6 5 5 / 0%), rgb(6 5 5 / 74%));
        content: '';
        inset: 0;
        position: absolute;
      }

      .hero-shield,
      .hero-copy {
        position: relative;
        z-index: 1;
      }

      .hero-shield {
        color: #db9d48;
        font-size: 1.25rem;
        padding: 0.7rem 0 0 1rem;
      }

      .hero-copy {
        align-items: center;
        display: flex;
        gap: 0.9rem;
        padding: 0.15rem clamp(0.9rem, 3vw, 3.6rem) 0.85rem;
      }

      .dragon-mark {
        color: #c67528;
        font-size: 3rem;
        line-height: 1;
        text-shadow: 0 0 24px rgb(198 117 40 / 45%);
      }

      .hero-copy h1 {
        color: #ffdda2;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.15rem, 4vw, 3.25rem);
        line-height: 0.96;
        text-shadow: 0 3px 18px rgb(0 0 0 / 70%);
      }

      .hero-copy p {
        color: #cfc1ad;
        font-size: 0.9rem;
        line-height: 1.35;
        margin-top: 0.45rem;
        max-width: 34rem;
      }

      .setup-progress {
        background: rgb(13 13 14 / 88%);
        border: 1px solid rgb(194 129 56 / 45%);
        border-radius: 0.75rem;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        list-style: none;
        overflow: hidden;
        padding: 0;
      }

      .setup-progress li {
        align-items: center;
        border-right: 1px solid rgb(194 129 56 / 25%);
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto 1fr;
        min-height: 3.65rem;
        padding: 0.55rem 0.7rem;
        position: relative;
      }

      .setup-progress li:last-child {
        border-right: 0;
      }

      .setup-progress li.active {
        background: linear-gradient(90deg, rgb(255 78 119 / 20%), rgb(255 78 119 / 7%));
        box-shadow: inset 0 -2px 0 rgb(255 80 125 / 86%);
      }

      .setup-progress span {
        border: 2px solid rgb(180 151 105 / 70%);
        border-radius: 999px;
        color: #d7c5a7;
        display: grid;
        font-weight: 900;
        height: 2rem;
        place-items: center;
        width: 2rem;
      }

      .setup-progress li.complete span {
        border-color: #56e36e;
        color: #56e36e;
      }

      .setup-progress li.active span {
        border-color: #ff6f9e;
        color: #ff8ab1;
      }

      .setup-progress strong,
      .panel h2,
      .repository-title {
        color: #f4eadb;
      }

      .setup-progress em {
        color: #9bdc91;
        display: block;
        font-size: 0.68rem;
        font-style: normal;
        margin-top: 0.1rem;
      }

      .setup-progress li.active em {
        color: #ff9ab8;
      }

      .setup-grid {
        display: grid;
        gap: 0.65rem;
        margin-top: 0.65rem;
      }

      .top-grid {
        grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1.25fr) minmax(0, 1fr);
      }

      .lower-grid {
        grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr) minmax(0, 1fr);
      }

      .panel,
      .developer-commands,
      .setup-footer {
        background: linear-gradient(180deg, rgb(25 25 27 / 88%), rgb(12 12 13 / 92%));
        border: 1px solid rgb(194 129 56 / 30%);
        border-radius: 0.72rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%), 0 18px 40px rgb(0 0 0 / 28%);
        min-width: 0;
        padding: 0.78rem;
      }

      .panel h2,
      .developer-commands h2 {
        font-size: 0.78rem;
        letter-spacing: 0.05em;
        margin-bottom: 0.55rem;
        text-transform: uppercase;
      }

      .panel p,
      .panel label,
      .developer-commands p,
      .developer-commands li {
        color: #b9ad9e;
        font-size: 0.72rem;
        line-height: 1.4;
      }

      .panel button,
      .setup-footer button,
      .developer-commands button {
        background: rgb(25 23 22 / 90%);
        border: 1px solid rgb(194 129 56 / 34%);
        border-radius: 0.45rem;
        color: #e7cda2;
        min-height: 2rem;
        padding: 0 0.65rem;
      }

      .account-panel {
        align-content: start;
        display: grid;
        gap: 0.55rem;
        grid-template-columns: auto 1fr;
      }

      .account-panel button {
        grid-column: 1 / -1;
      }

      .panel-icon,
      .bank-icon {
        border: 3px solid rgb(73 221 100 / 74%);
        border-radius: 999px;
        color: #59e571;
        display: grid;
        font-size: 1.45rem;
        height: 3.35rem;
        place-items: center;
        width: 3.35rem;
      }

      .account-panel strong,
      .payout-panel strong {
        color: #5cea72;
        display: block;
        margin-bottom: 0.4rem;
      }

      .mode-toggle {
        display: grid;
        gap: 0.55rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0.65rem 0;
      }

      .mode-toggle button.active {
        background: linear-gradient(180deg, rgb(132 32 52 / 58%), rgb(40 21 25 / 92%));
        border-color: rgb(255 83 119 / 75%);
        box-shadow: 0 0 22px rgb(255 83 119 / 20%);
        color: #ffd4d9;
      }

      .mode-panel aside {
        background: rgb(54 29 8 / 64%);
        border: 1px solid rgb(224 142 45 / 50%);
        border-radius: 0.45rem;
        color: #f4b754;
        display: grid;
        gap: 0.25rem;
        padding: 0.7rem;
      }

      .keys-panel,
      .webhook-panel,
      .quick-panel {
        display: grid;
        gap: 0.45rem;
      }

      .keys-panel label,
      .webhook-panel label {
        display: grid;
        gap: 0.35rem;
      }

      .keys-panel label span,
      .webhook-panel label span {
        display: grid;
        gap: 0.55rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .keys-panel code,
      .webhook-panel code,
      .developer-commands code {
        background: rgb(11 11 12 / 92%);
        border: 1px solid rgb(255 255 255 / 10%);
        border-radius: 0.42rem;
        color: #d7c7ae;
        overflow: auto;
        padding: 0.5rem;
        white-space: nowrap;
      }

      .subtle {
        justify-self: start;
      }

      .payout-panel {
        display: grid;
        justify-items: center;
        text-align: center;
      }

      .bank-icon {
        border-color: rgb(194 129 56 / 65%);
        color: #d79b47;
      }

      .webhook-panel header {
        align-items: center;
        display: flex;
        justify-content: space-between;
      }

      .webhook-panel header span {
        background: rgb(64 184 83 / 20%);
        border-radius: 999px;
        color: #72e47c;
        padding: 0.18rem 0.55rem;
      }

      .event-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.32rem;
      }

      .event-chips span {
        background: rgb(255 255 255 / 7%);
        border: 1px solid rgb(255 255 255 / 10%);
        border-radius: 0.35rem;
        color: #d8d1c7;
        font-size: 0.66rem;
        padding: 0.25rem 0.42rem;
      }

      .panel-actions {
        display: grid;
        gap: 0.4rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .security-panel ul {
        display: grid;
        gap: 0.36rem;
        list-style: none;
        padding: 0;
      }

      .security-panel li {
        align-items: center;
        display: grid;
        gap: 0.42rem;
        grid-template-columns: auto 1fr auto;
      }

      .security-panel li span,
      .security-panel li em {
        color: #67e477;
      }

      .security-panel li.progress span,
      .security-panel li.progress em {
        color: #f3a020;
      }

      .security-panel li strong {
        color: #d9cec0;
        font-size: 0.82rem;
      }

      .security-panel li em {
        font-size: 0.75rem;
        font-style: normal;
      }

      .guide {
        margin-top: 0.8rem;
        width: 100%;
      }

      .quick-panel button {
        align-items: center;
        display: flex;
        justify-content: space-between;
        min-height: 2.6rem;
        text-align: left;
      }

      .quick-panel button.danger {
        background: rgb(66 18 28 / 72%);
        border-color: rgb(255 80 116 / 72%);
        color: #ffe3e7;
      }

      .quick-panel button.gold {
        background: linear-gradient(180deg, rgb(142 79 21 / 88%), rgb(63 33 9 / 96%));
        border-color: rgb(235 151 50 / 80%);
        color: #ffe2a7;
      }

      .quick-panel small {
        color: #d5a65a;
        display: block;
        font-size: 0.65rem;
      }

      .developer-commands {
        margin-top: 0.95rem;
        padding: 1rem;
      }

      .developer-commands h2 {
        font-size: 1.05rem;
        margin-bottom: 0.95rem;
      }

      .developer-commands ol {
        display: grid;
        gap: 0.9rem;
        list-style: none;
        padding: 0;
      }

      .developer-commands li {
        border: 1px solid rgb(255 255 255 / 8%);
        border-radius: 0.6rem;
        overflow: hidden;
      }

      .developer-commands li.done {
        border-color: rgb(75 218 95 / 26%);
      }

      .developer-commands li.blocked {
        border-color: rgb(255 79 119 / 35%);
      }

      .developer-commands li:not(:focus-within):not(:hover) .command-detail {
        display: none;
      }

      .developer-commands .command-step {
        align-items: center;
        background: rgb(12 12 13 / 82%);
        border: 0;
        border-radius: 0;
        display: grid;
        gap: 0.95rem;
        grid-template-columns: auto 1fr auto;
        min-height: 4.15rem;
        padding: 0 1rem;
        text-align: left;
        width: 100%;
      }

      .developer-commands .command-step span {
        border: 1px solid rgb(194 129 56 / 52%);
        border-radius: 999px;
        display: grid;
        font-size: 1rem;
        height: 2.35rem;
        place-items: center;
        width: 2.35rem;
      }

      .developer-commands .command-step strong {
        color: #f3e8d6;
        font-size: 1rem;
      }

      .developer-commands .command-step em {
        color: #d9a85d;
        font-size: 0.88rem;
        font-style: normal;
      }

      .command-detail {
        display: grid;
        gap: 0.8rem;
        padding: 1rem;
      }

      .command-detail p,
      .command-detail li {
        font-size: 0.9rem;
      }

      .command-detail ul {
        padding-left: 1.2rem;
      }

      .command-detail article {
        align-items: center;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: minmax(8rem, 0.32fr) minmax(0, 1fr) auto auto;
      }

      .command-detail article span {
        color: #d8c7aa;
        font-size: 0.88rem;
      }

      .developer-commands code {
        font-size: 0.9rem;
        padding: 0.78rem;
      }

      .command-detail button {
        min-height: 2.45rem;
      }

      .setup-footer {
        align-items: center;
        display: grid;
        gap: 0.7rem;
        grid-template-columns: minmax(24rem, 1fr) auto auto;
        margin-top: 0.65rem;
      }

      .setup-footer span {
        color: #d3c6b4;
      }

      .setup-footer div {
        display: flex;
        gap: 0.5rem;
      }

      .setup-footer small {
        color: #9f927f;
        grid-column: 1 / -1;
      }

      @media (max-width: 900px) {
        .admin-sidebar {
          align-items: center;
          display: grid;
          gap: 0.55rem 1rem;
          grid-template-columns: auto minmax(0, 1fr);
          inset: auto;
          width: 14rem;
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

        .admin-sidebar section:first-of-type nav,
        .admin-sidebar section:nth-of-type(2) nav {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .admin-sidebar section {
          margin-top: 0;
        }

        .admin-sidebar section:first-of-type,
        .admin-sidebar section:nth-of-type(2) {
          grid-column: 1 / -1;
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

        .admin-workspace {
          margin-left: 0;
        }

      }

      @media (max-width: 1100px) {
        .top-grid,
        .lower-grid,
        .setup-footer {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        .admin-sidebar {
          inset: auto;
          min-height: auto;
          position: relative;
          width: auto;
        }

        .admin-workspace {
          margin-left: 0;
          padding: 0.75rem;
        }

        .admin-topbar,
        .admin-topbar div,
        .hero-copy,
        .setup-footer div {
          align-items: flex-start;
          flex-direction: column;
        }

        .setup-progress {
          grid-template-columns: 1fr;
        }

        .setup-progress li {
          border-right: 0;
          border-bottom: 1px solid rgb(194 129 56 / 25%);
        }

        .hero-copy h1 {
          font-size: 2.4rem;
        }

        .admin-sidebar nav,
        .mode-toggle,
        .panel-actions,
        .command-detail article {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class StripeSetupPageComponent implements OnInit {
  private readonly setupService = inject(StripeSetupDevService);

  readonly status = signal<StripeSetupDevStatus>(fallbackStatus);
  readonly completedStepIds = signal<readonly string[]>(this.loadCompletedSteps());
  readonly loadError = signal<boolean>(false);
  readonly paymentMode = signal<'test' | 'live'>('live');

  readonly setupStages = computed<readonly SetupStage[]>(() => {
    const status = this.status();
    const keysReady = status.stripeSecretKeyConfigured && status.stripeWebhookSecretConfigured;

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
        detail: this.transparencySourceLabel(),
        state: status.transparencySource !== 'none' ? 'complete' : status.apiReachable ? 'active' : 'pending'
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
        detail: keysReady && this.paymentMode() === 'live' ? 'Pret' : 'A faire',
        state: keysReady && this.paymentMode() === 'live' ? 'complete' : 'pending'
      }
    ];
  });

  readonly securityChecks = computed<readonly SecurityCheck[]>(() => {
    const status = this.status();

    return [
      { label: 'Utiliser des cles API restreintes', state: status.stripeSecretKeyConfigured ? 'complete' : 'progress' },
      { label: "Activer l'authentification 2FA", state: 'complete' },
      { label: 'Configurer les webhooks', state: status.stripeWebhookSecretConfigured ? 'complete' : 'progress' },
      { label: 'Limiter les acces aux cles secretes', state: 'complete' },
      { label: 'Surveiller les evenements Stripe', state: status.apiReachable ? 'complete' : 'progress' }
    ];
  });

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
        title: 'Sans PostgreSQL au lancement',
        description: 'Pour le lancement rapide, les statistiques publiques lisent Stripe directement. PostgreSQL reste une option future seulement.',
        status: 'verified',
        statusLabel: status.databaseReachable ? 'Journal actif' : 'Non requis',
        checklist: [
          status.transparencySource === 'stripe' ? 'Mode lancement rapide: Stripe direct' : 'Stripe direct en attente de cle API',
          'Laisser DATABASE_URL vide pour ce lancement',
          status.databaseReachable ? 'Journal PostgreSQL actif par configuration locale' : 'Aucune base PostgreSQL requise'
        ],
        commands: [],
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
        title: "Demarrer le site et l'API",
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
            url: 'http://localhost:8080'
          }
        ]
      },
      {
        id: 'test-events',
        title: 'Declencher les evenements test',
        description: 'Envoie les evenements Stripe MVP pour verifier le paiement, l expiration, les echecs, les remboursements et les versements.',
        status: 'manual',
        statusLabel: 'Commande locale',
        checklist: ['Le terminal stripe listen doit rester ouvert pendant ce test'],
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
        description: "Confirme que l'API agregee et la page publique repondent localement.",
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


  transparencySourceLabel(): string {
    const source = this.status().transparencySource;
    if (source === 'database') {
      return 'PostgreSQL actif';
    }

    if (source === 'stripe') {
      return 'Stripe direct';
    }

    return 'A configurer';
  }
  setPaymentMode(mode: 'test' | 'live'): void {
    this.paymentMode.set(mode);
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
