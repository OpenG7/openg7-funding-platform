import type {
  AdminAttentionItem,
  AdminAttentionItemType
} from '@openg7/funding-core';

import type { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Local display labels; no routing, session or HTTP state. */
export class AdminAssistantLabels {
  constructor(private readonly i18n: FundingI18nService) {}
  typeLabel(type: AdminAttentionItemType): string {
    return this.i18n.t('admin.attention.types.' + type);
  }
  title(item: AdminAttentionItem): string {
    if (item.type === 'email_delivery_failed')
      return this.templateLabel(String(item.facts['templateKey'] ?? ''));
    return String(item.facts['reference'] ?? this.typeLabel(item.type));
  }
  templateLabel(template: string): string {
    const key = 'admin.assistantOverview.templates.' + template;
    const label = this.i18n.t(key);
    return label === key
      ? this.i18n.t('admin.assistantOverview.templates.other')
      : label;
  }
  errorLabel(error: string): string {
    const key = 'admin.assistantOverview.errors.' + error;
    const label = this.i18n.t(key);
    return label === key
      ? this.i18n.t('admin.assistantOverview.errors.autre')
      : label;
  }
  missingFields(item: AdminAttentionItem): string[] {
    return String(item.facts['missingFields'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((field) => {
        const key = 'admin.context.fields.' + field;
        const label = this.i18n.t(key);
        return label === key
          ? this.i18n.t('admin.assistantOverview.missingInformation')
          : label;
      });
  }
  reason(item: AdminAttentionItem): string {
    const days = item.facts['daysSincePaid'] ?? item.facts['daysWaiting'];
    if (typeof days === 'number')
      return this.i18n.t('admin.assistantOverview.waiting', { days });
    if (item.type === 'email_delivery_failed')
      return this.i18n.t(
        item.facts['attemptsExhausted']
          ? 'admin.assistantOverview.exhausted'
          : 'admin.assistantOverview.attempts',
        { count: item.facts['attempts'], max: item.facts['maxAttempts'] }
      );
    if (item.dueAt)
      return this.i18n.t('admin.assistantOverview.due', {
        date: this.dateLabel(item.dueAt)
      });
    return this.i18n.t('admin.attention.reasons.' + item.type);
  }
  amount(item: AdminAttentionItem): string {
    const amount = item.facts['amount'],
      currency = item.facts['currency'];
    return typeof amount === 'number' && typeof currency === 'string'
      ? new Intl.NumberFormat(this.i18n.currentLanguage()).format(amount) +
          ' ' +
          currency
      : '';
  }
  dateLabel(value: string): string {
    return Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
        }).format(new Date(value))
      : this.i18n.t('admin.dashboard.notAvailable');
  }
}
