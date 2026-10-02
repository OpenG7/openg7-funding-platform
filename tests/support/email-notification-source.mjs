import { readFileSync } from 'node:fs';

// Historical source contracts follow the service and its extracted rendering modules.
// Delivery and rendering behavior have separate executable coverage.
export const readEmailNotificationSource = () => {
  const root = 'apps/funding-api/src/';
  return [
    'email-notification.service.ts',
    'services/email/email-notification.types.ts',
    'services/email/email-rendering.ts',
    'services/email/email.templates.ts',
    'services/email/sponsorship.templates.ts',
    'services/email/sponsorship-documents.templates.ts'
  ]
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
