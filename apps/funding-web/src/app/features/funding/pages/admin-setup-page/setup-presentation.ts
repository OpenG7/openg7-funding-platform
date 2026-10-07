import type {
  AdminSetupStatusResponse,
  AdminEmailTestResult
} from '@openg7/funding-core';

import {
  IDENTITY_SETUP_ENV_KEYS,
  type IdentitySetupEnvKey
} from '../../components/admin-identity-setup/identity-setup-fields.js';
import type { FundingI18nService } from '../../services/funding-i18n.service.js';

export type SetupEmailTestState =
  | 'idle'
  | 'submitting'
  | 'checking'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'error';
export type SetupEnvKey =
  | IdentitySetupEnvKey
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'SMTP_ENABLED'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'MAIL_FROM_ADDRESS'
  | 'MAIL_REPLY_TO_ADDRESS'
  | 'FUNDING_ADMIN_NOTIFICATION_EMAIL'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS'
  | 'FUNDING_SPONSORSHIP_INVOICE_PREFIX'
  | 'FUNDING_INVOICE_ISSUER_NAME'
  | 'FUNDING_INVOICE_ISSUER_EMAIL'
  | 'FUNDING_INVOICE_ISSUER_ADDRESS'
  | 'FUNDING_INVOICE_TAX_ID'
  | 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL'
  | 'DATABASE_URL';

export interface SetupEnvRow {
  readonly key: SetupEnvKey;
  readonly label: string;
  readonly note: string;
}

export interface SetupEmailTestView {
  readonly email: string;
  readonly state: SetupEmailTestState;
  readonly busy: boolean;
  readonly message: string;
  readonly result: Readonly<AdminEmailTestResult> | null;
  readonly requestId: string | null;
}

/** Formatting and translated configuration rows; no loading or mutable state. */
export class SetupPresentation {
  constructor(
    private readonly i18n: Pick<FundingI18nService, 't' | 'currentLanguage'>
  ) {}
  get envRows(): readonly SetupEnvRow[] {
    return [
      ...IDENTITY_SETUP_ENV_KEYS.map((key) => ({
        key,
        label: key,
        note: this.i18n.t('admin.identitySetup.variables.' + key)
      })),
      {
        key: 'STRIPE_SECRET_KEY',
        label: this.i18n.t('admin.messages.stripe_secret'),
        note: this.i18n.t('admin.messages.checkout_et_lecture_stripe_direct')
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        label: this.i18n.t('admin.messages.stripe_webhook'),
        note: this.i18n.t('admin.messages.validation_des_evenements_stripe')
      },
      {
        key: 'SMTP_ENABLED',
        label: 'SMTP active',
        note: this.i18n.t('admin.messages.active_les_envois_transactionnels')
      },
      {
        key: 'SMTP_HOST',
        label: this.i18n.t('admin.messages.serveur_smtp'),
        note: this.i18n.t(
          'admin.messages.hote_hostpapa_ou_fournisseur_equivalent'
        )
      },
      {
        key: 'SMTP_PORT',
        label: this.i18n.t('admin.messages.port_smtp'),
        note: this.i18n.t('admin.messages.port_de_connexion_smtp')
      },
      {
        key: 'SMTP_SECURE',
        label: 'TLS SMTP',
        note: this.i18n.t('admin.messages.connexion_tls_implicite')
      },
      {
        key: 'SMTP_USER',
        label: this.i18n.t('admin.messages.utilisateur_smtp'),
        note: this.i18n.t('admin.messages.adresse_complete_de_la_boite_notify')
      },
      {
        key: 'SMTP_PASSWORD',
        label: this.i18n.t('admin.messages.mot_de_passe_smtp'),
        note: this.i18n.t(
          'admin.messages.secret_prive_injecte_cote_serveur_seulement'
        )
      },
      {
        key: 'MAIL_FROM_ADDRESS',
        label: this.i18n.t('admin.messages.expediteur'),
        note: this.i18n.t('admin.messages.adresse_visible_comme_expediteur')
      },
      {
        key: 'MAIL_REPLY_TO_ADDRESS',
        label: 'Reply-to',
        note: this.i18n.t(
          'admin.messages.adresse_de_reponse_des_commanditaires'
        )
      },
      {
        key: 'FUNDING_ADMIN_NOTIFICATION_EMAIL',
        label: this.i18n.t('admin.legacy.notification_admin'),
        note: this.i18n.t('admin.messages.alertes_internes_et_rappels_admin')
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED',
        label: this.i18n.t('admin.legacy.rappel_approbation'),
        note: this.i18n.t(
          'admin.messages.active_le_rappel_quotidien_des_commandites_a_approuver'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS',
        label: this.i18n.t('admin.messages.age_rappel_approbation'),
        note: this.i18n.t(
          'admin.messages.nombre_de_jours_avant_le_premier_rappel'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS',
        label: this.i18n.t('admin.messages.intervalle_rappel'),
        note: this.i18n.t(
          'admin.messages.frequence_de_verification_des_rappels_admin'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS',
        label: this.i18n.t('admin.messages.dossiers_dans_le_rappel'),
        note: this.i18n.t(
          'admin.messages.nombre_maximal_de_dossiers_listes_dans_le_courriel'
        )
      },
      {
        key: 'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
        label: this.i18n.t('admin.messages.prefixe_facture'),
        note: this.i18n.t('admin.messages.numerotation_des_factures_commandite')
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_NAME',
        label: this.i18n.t('admin.legacy.emetteur_facture'),
        note: this.i18n.t('admin.messages.nom_legal_ou_public_sur_la_facture')
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_EMAIL',
        label: this.i18n.t('admin.legacy.courriel_facture'),
        note: this.i18n.t(
          'admin.messages.courriel_affiche_dans_le_bloc_emetteur'
        )
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_ADDRESS',
        label: this.i18n.t('admin.messages.adresse_facture'),
        note: this.i18n.t('admin.messages.adresse_affichee_si_configuree')
      },
      {
        key: 'FUNDING_INVOICE_TAX_ID',
        label: this.i18n.t('admin.messages.identifiant_fiscal'),
        note: this.i18n.t('admin.messages.numero_fiscal_affiche_si_applicable')
      },
      {
        key: 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL',
        label: this.i18n.t('admin.messages.libelle_taxes'),
        note: this.i18n.t('admin.messages.texte_de_taxe_affiche_sur_la_facture')
      },
      {
        key: 'DATABASE_URL',
        label: 'PostgreSQL',
        note: this.i18n.t('admin.setup.databaseNote')
      }
    ];
  }

  envConfigured(
    setup: AdminSetupStatusResponse,
    key: SetupEnvKey
  ): boolean | null {
    const identity = setup.identity?.mode === 'oidc' ? setup.identity : null;
    switch (key) {
      case 'FUNDING_ADMIN_AUTH_MODE':
        return setup.identity ? true : null;
      case 'FUNDING_PUBLIC_BASE_URL':
        return Boolean(setup.public_base_url);
      case 'FUNDING_ADMIN_OIDC_ISSUER':
        return identity ? Boolean(identity.issuer) : null;
      case 'FUNDING_ADMIN_OIDC_CLIENT_ID':
        return identity?.client_id_configured ?? null;
      case 'FUNDING_ADMIN_OIDC_CLIENT_SECRET':
        return identity?.client_secret_configured ?? null;
      case 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS':
        return identity?.owner_bootstrap_configured ?? null;
      case 'FUNDING_ADMIN_OIDC_MFA_ACR':
        return identity ? true : null;
      case 'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY':
        return identity?.private_data_encryption_configured ?? null;
      case 'STRIPE_SECRET_KEY':
        return setup.stripe.secret_key_configured;
      case 'STRIPE_WEBHOOK_SECRET':
        return setup.stripe.webhook_secret_configured;
      case 'SMTP_ENABLED':
        return setup.email.smtp_enabled;
      case 'SMTP_HOST':
        return Boolean(setup.email.smtp_host);
      case 'SMTP_PORT':
        return setup.email.smtp_port > 0;
      case 'SMTP_SECURE':
        return setup.email.smtp_secure;
      case 'SMTP_USER':
        return setup.email.smtp_user_configured;
      case 'SMTP_PASSWORD':
        return setup.email.smtp_password_configured;
      case 'MAIL_FROM_ADDRESS':
        return Boolean(setup.email.from);
      case 'MAIL_REPLY_TO_ADDRESS':
        return Boolean(setup.email.reply_to);
      case 'FUNDING_ADMIN_NOTIFICATION_EMAIL':
        return Boolean(setup.email.admin_notification_email);
      case 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED':
        return setup.email.admin_review_reminder_enabled;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS':
        return setup.email.admin_review_reminder_min_age_days >= 0;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS':
        return setup.email.admin_review_reminder_poll_interval_ms > 0;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS':
        return setup.email.admin_review_reminder_max_items > 0;
      case 'FUNDING_SPONSORSHIP_INVOICE_PREFIX':
        return Boolean(setup.invoice.prefix);
      case 'FUNDING_INVOICE_ISSUER_NAME':
        return Boolean(setup.invoice.issuer_name);
      case 'FUNDING_INVOICE_ISSUER_EMAIL':
        return Boolean(setup.invoice.issuer_email);
      case 'FUNDING_INVOICE_ISSUER_ADDRESS':
        return setup.invoice.issuer_address_configured;
      case 'FUNDING_INVOICE_TAX_ID':
        return setup.invoice.issuer_tax_id_configured;
      case 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL':
        return Boolean(setup.invoice.tax_label);
      case 'DATABASE_URL':
        return setup.database.configured && setup.database.reachable;
    }
  }

  readyLabel(ready: boolean): string {
    return this.i18n.t(
      ready ? 'admin.setup.configured' : 'admin.setup.incomplete'
    );
  }

  envStateLabel(setup: AdminSetupStatusResponse, key: SetupEnvKey): string {
    if (key === 'FUNDING_ADMIN_AUTH_MODE' && setup.identity)
      return this.i18n.t('admin.identitySetup.modes.' + setup.identity.mode);
    if (
      key.startsWith('FUNDING_ADMIN_OIDC_') ||
      key === 'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY'
    ) {
      if (setup.identity?.mode === 'token')
        return this.i18n.t('admin.identitySetup.observations.manual');
      if (key === 'FUNDING_ADMIN_OIDC_MFA_ACR' && setup.identity)
        return this.i18n.t(
          'admin.identitySetup.policies.' + setup.identity.mfa_policy
        );
      if (
        key === 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS' &&
        setup.identity &&
        !setup.identity.owner_bootstrap_configured
      )
        return this.i18n.t('admin.identitySetup.ownerExisting');
    }
    return this.configuredLabel(this.envConfigured(setup, key));
  }

  configuredLabel(configured: boolean | null): string {
    if (configured === null)
      return this.i18n.t('admin.identitySetup.observations.unknown');
    return configured
      ? this.i18n.t('admin.messages.configure')
      : this.i18n.t('admin.messages.manquant');
  }

  enabledLabel(enabled: boolean): string {
    return enabled
      ? this.i18n.t('admin.dossier.yes')
      : this.i18n.t('admin.dossier.no');
  }

  valueLabel(value: string | null): string {
    return value?.trim() ? value : this.i18n.t('admin.messages.non_configure');
  }

  originsLabel(origins: readonly string[]): string {
    return origins.length > 0
      ? origins.join(', ')
      : this.i18n.t('admin.messages.aucune_origine_explicite');
  }

  dataSourceLabel(source: AdminSetupStatusResponse['data_source']): string {
    switch (source) {
      case 'database':
        return 'PostgreSQL';
      case 'stripe_direct':
        return 'Stripe-direct';
      case 'empty':
        return this.i18n.t('admin.messages.aucune_source');
    }
  }

  dateLabel(iso: string | null): string {
    if (!iso) {
      return this.i18n.t('admin.messages.jamais');
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }
}
