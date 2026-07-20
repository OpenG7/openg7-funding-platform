export {
  getTransactionalEmailConfigStatus,
  isValidEmailAddress,
  loadTransactionalEmailConfig,
  maskEmailAddress
} from './email.config.js';
export {
  sendTransactionalEmail,
  toTransactionalEmailError,
  verifyEmailTransport
} from './email.service.js';
export { renderSmtpConfigurationTestEmail } from './email.templates.js';
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
