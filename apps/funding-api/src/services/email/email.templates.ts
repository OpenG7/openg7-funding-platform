import type { SendTransactionalEmailInput } from './email.types.js';

interface SmtpConfigurationTestEmailInput {
  readonly fromAddress: string;
  readonly replyToAddress: string;
}

export const renderSmtpConfigurationTestEmail = (
  input: SmtpConfigurationTestEmailInput
): Omit<SendTransactionalEmailInput, 'to'> => ({
  subject: 'Test SMTP OpenG7',
  text: [
    'La configuration SMTP transactionnelle d OpenG7 fonctionne correctement.',
    '',
    `Expediteur : ${input.fromAddress}`,
    `Adresse de reponse : ${input.replyToAddress}`
  ].join('\n'),
  html: `
      <p>
        La configuration SMTP transactionnelle d'OpenG7 fonctionne correctement.
      </p>
      <p>
        <strong>Expediteur :</strong> ${input.fromAddress}<br />
        <strong>Adresse de reponse :</strong> ${input.replyToAddress}
      </p>
    `
});
