import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminGlobalSearchComponent } from '../admin-search/admin-global-search.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

interface AdminNavigationGroup {
  readonly key: string;
  readonly links: readonly {
    readonly key: string;
    readonly url: string;
    readonly icon: AdminIconName;
  }[];
}

@Component({
  selector: 'openg7-admin-nav',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    AdminIconComponent,
    AdminGlobalSearchComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      [class.collapsible]="collapsible()"
      [class.expanded]="expanded()"
      [attr.aria-label]="'admin.nav.label' | translate"
      (keydown.escape)="closeMenu(toggle)"
    >
      <header class="brand">
        <a
          routerLink="/admin/fundraiser"
          class="brand-link"
          (click)="expanded.set(false)"
          [attr.aria-label]="'admin.nav.home' | translate"
        >
          <span class="brand-mark" aria-hidden="true">G7</span>
          <span
            ><strong>Open G7</strong
            ><small>{{ 'funding.brand.title' | translate }}</small></span
          >
        </a>
        <button
          #toggle
          class="admin-button menu-toggle"
          type="button"
          (click)="expanded.set(!expanded())"
          [attr.aria-expanded]="expanded()"
          aria-controls="admin-navigation-content"
          [attr.aria-label]="
            (expanded() ? 'admin.nav.close' : 'admin.nav.open') | translate
          "
        >
          <openg7-admin-icon [name]="expanded() ? 'close' : 'menu'" />
          {{ 'admin.nav.menu' | translate }}
        </button>
      </header>
      @if (!collapsible()) {
        <openg7-admin-global-search />
      }
      <div id="admin-navigation-content" class="navigation-content">
        @if (queueReturn(); as destination) {
          <a
            class="admin-link"
            [routerLink]="destination"
            data-og7="return-to-attention"
            >{{ 'admin.attention.back' | translate }}</a
          >
        }
        <nav [attr.aria-label]="'admin.nav.label' | translate">
          @for (group of groups; track group.key) {
            <section [attr.aria-labelledby]="'admin-group-' + group.key">
              <h2 [id]="'admin-group-' + group.key">
                {{ 'admin.nav.' + group.key | translate }}
              </h2>
              @for (link of group.links; track link.url) {
                <a
                  [routerLink]="link.url"
                  routerLinkActive="active"
                  ariaCurrentWhenActive="page"
                  [routerLinkActiveOptions]="{
                    exact: link.url === '/admin/fundraiser'
                  }"
                  (click)="closeMenu(toggle)"
                  [attr.aria-describedby]="
                    badge(link.key) ? 'admin-count-' + link.key : null
                  "
                >
                  <openg7-admin-icon [name]="link.icon" />{{
                    'admin.nav.' + link.key | translate
                  }}
                  @if (badge(link.key); as count) {
                    <span
                      class="action-count"
                      aria-hidden="true"
                      data-og7="nav-count"
                      [attr.data-og7-id]="link.key"
                      >{{ count }}</span
                    >
                  }
                </a>
                @if (badge(link.key); as count) {
                  <span
                    class="count-description"
                    [id]="'admin-count-' + link.key"
                    >{{
                      'admin.dossier.actionCount' | translate: { count }
                    }}</span
                  >
                }
              }
            </section>
          }
        </nav>
        <footer>
          @if (admin.identity(); as identity) {
            <p>
              {{ identity.displayName }} ·
              {{ 'admin.access.roles.' + identity.role | translate }}
            </p>
            @if (identity.role === 'owner') {
              <a routerLink="/admin/fundraiser/access">{{
                'admin.access.title' | translate
              }}</a>
            }
            @if (identity.role === 'reader') {
              <p role="status">{{ 'admin.access.readOnly' | translate }}</p>
            }
          }
          @if (logoutFailed()) {
            <p role="alert">{{ 'admin.access.logoutFailed' | translate }}</p>
          }
          <div class="signature">
            <openg7-admin-icon name="mountain" />
            <p>{{ 'admin.nav.motto' | translate }}</p>
          </div>
          <button type="button" (click)="clearSession()">
            <openg7-admin-icon name="logout" />{{
              'admin.nav.signOut' | translate
            }}
          </button>
          <a [routerLink]="i18n.localizedPath('/fonds-des-batisseurs')"
            ><openg7-admin-icon name="arrow" />{{
              'admin.nav.public' | translate
            }}</a
          >
        </footer>
      </div>
    </aside>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-nav.component.css'
  ]
})
export class AdminNavComponent implements OnInit {
  readonly admin = inject(FundingAdminService);
  readonly logoutFailed = signal(false);
  private readonly router = inject(Router);
  private readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap);
  readonly queueReturn = computed(() => {
    const value = this.queryParams()?.get('returnTo');
    return value && /^\/admin\/fundraiser\/attention(?:\?|$)/.test(value)
      ? this.router.parseUrl(value)
      : null;
  });
  readonly i18n = inject(FundingI18nService);
  readonly collapsible = input(false);
  readonly expanded = signal(false);
  ngOnInit(): void {
    // The cockpit and queue page already load the same projection.
    if (
      typeof window !== 'undefined' &&
      !/^\/admin\/fundraiser(?:\?|$)|^\/admin\/fundraiser\/attention(?:\?|$)/.test(
        this.router.url
      )
    )
      void this.admin.refreshWorkQueue();
  }
  badge(key: string): number {
    const counts = this.admin.workQueue()?.actionCounts;
    if (!counts) return 0;
    if (key === 'attention')
      return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
    if (key === 'sponsors')
      return (
        (counts.sponsorship_needs_info ?? 0) +
        (counts.sponsorship_needs_review ?? 0)
      );
    if (key === 'email') return counts.email_delivery_failed ?? 0;
    if (key === 'invoices') return counts.invoice_missing ?? 0;
    if (key === 'publications')
      return (
        (counts.publication_needs_preparation ?? 0) +
        (counts.publication_late ?? 0) +
        (counts.publication_ready ?? 0) +
        (counts.publication_slot_upcoming ?? 0)
      );
    return 0;
  }
  readonly groups: readonly AdminNavigationGroup[] = [
    {
      key: 'steering',
      links: [
        { key: 'dashboard', url: '/admin/fundraiser', icon: 'dashboard' },
        { key: 'attention', url: '/admin/fundraiser/attention', icon: 'audit' },
        {
          key: 'assistant',
          url: '/admin/fundraiser/assistant',
          icon: 'assistant'
        }
      ]
    },
    {
      key: 'operations',
      links: [
        {
          key: 'contributions',
          url: '/admin/fundraiser/contributions',
          icon: 'contributions'
        },
        {
          key: 'sponsors',
          url: '/admin/fundraiser/sponsors',
          icon: 'sponsors'
        },
        {
          key: 'publications',
          url: '/admin/fundraiser/publications',
          icon: 'publications'
        }
      ]
    },
    {
      key: 'finance',
      links: [
        {
          key: 'invoices',
          url: '/admin/fundraiser/invoices',
          icon: 'invoices'
        },
        {
          key: 'expenses',
          url: '/admin/fundraiser/expenses',
          icon: 'expenses'
        },
        {
          key: 'transparency',
          url: '/admin/fundraiser/transparency',
          icon: 'transparency'
        }
      ]
    },
    {
      key: 'system',
      links: [
        { key: 'email', url: '/admin/fundraiser/email-queue', icon: 'email' },
        { key: 'audit', url: '/admin/fundraiser/audit', icon: 'audit' },
        { key: 'settings', url: '/admin/fundraiser/setup', icon: 'settings' }
      ]
    }
  ];

  closeMenu(toggle: HTMLButtonElement): void {
    if (this.collapsible() && this.expanded()) {
      this.expanded.set(false);
      toggle.focus();
    }
  }

  async clearSession(): Promise<void> {
    try {
      await this.admin.signOut();
      await this.router.navigateByUrl('/admin/login');
    } catch {
      this.logoutFailed.set(true);
    }
  }
}
