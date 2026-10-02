export {
  getTransactionalEmailConfigStatus,
  isValidEmailAddress,
  loadEmailQueueWorkerEnabled,
  loadTransactionalEmailConfig,
  maskEmailAddress
} from './email.config.js';
export {
  sendTransactionalEmail,
  toTransactionalEmailError,
  verifyEmailTransport
} from './email.service.js';
export {
  renderSmtpConfigurationTestEmail,
  renderContributionReferenceRecoveryEmail,
  renderPublicationBatchFullNotification,
  renderSponsorshipReviewReminderNotification,
  renderEmailConfigurationTest,
  renderAdminContributionReceivedEmail
} from './email.templates.js';
export {
  renderSponsorshipFollowupEmail,
  renderSponsorshipConfirmationEmail,
  renderSponsorshipRejectionEmail,
  renderSponsorshipRefundEmail,
  renderSponsorshipAccessEmail,
  renderSponsorshipInformationRequestEmail
} from './sponsorship.templates.js';
export {
  renderSponsorshipInvoiceEmail,
  renderSponsorshipCreditNoteEmail
} from './sponsorship-documents.templates.js';
export type {
  EmailTemplateKey,
  SponsorshipFollowupEmailInput,
  ContributionReferenceRecoveryEmailInput,
  SponsorshipConfirmationEmailInput,
  SponsorshipInvoiceEmailInput,
  SponsorshipCreditNoteEmailInput,
  SponsorshipRejectionEmailInput,
  SponsorshipRefundEmailInput,
  PublicationBatchFullEmailInput,
  SponsorshipReviewReminderEmailItem,
  SponsorshipReviewReminderEmailInput,
  EmailConfigurationTestInput,
  RenderedEmail,
  SponsorshipAccessEmailInput,
  AdminContributionReceivedEmailInput,
  SponsorshipInformationRequestEmailInput
} from './email-notification.types.js';
export {
  TransactionalEmailError,
  type CreateEmailTransport,
  type EmailDeliveryMode,
  type EmailErrorCode,
  type EmailServiceDependencies,
  type EmailTransportOptions,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
  type TransactionalEmailConfig,
  type TransactionalEmailConfigStatus
} from './email.types.js';
