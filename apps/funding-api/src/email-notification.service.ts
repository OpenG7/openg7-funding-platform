interface SponsorshipFollowupEmailInput {
  readonly to: string;
  readonly followupUrl: string;
}

interface EmailSendResult {
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly error: string | null;
}

const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? '';
const emailFrom = process.env.FUNDING_EMAIL_FROM?.trim() ?? '';
const emailReplyTo = process.env.FUNDING_EMAIL_REPLY_TO?.trim() ?? '';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const sendSponsorshipFollowupEmail = async (
  input: SponsorshipFollowupEmailInput
): Promise<EmailSendResult> => {
  if (!resendApiKey || !emailFrom) {
    return {
      attempted: false,
      sent: false,
      error: 'Email provider is not configured.'
    };
  }

  const safeUrl = escapeHtml(input.followupUrl);
  const subject = 'Votre commandite OpenG7 est en validation';
  const text = [
    'Merci pour votre commandite OpenG7.',
    '',
    'Vous pouvez reprendre votre formulaire et suivre le statut ici:',
    input.followupUrl,
    '',
    'Aucune visibilite publique n est accordee avant validation manuelle.'
  ].join('\n');
  const html = `
    <p>Merci pour votre commandite OpenG7.</p>
    <p>
      Vous pouvez reprendre votre formulaire et suivre le statut ici:
      <br />
      <a href="${safeUrl}">${safeUrl}</a>
    </p>
    <p>
      Aucune visibilite publique n'est accordee avant validation manuelle.
    </p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [input.to],
        subject,
        text,
        html,
        ...(emailReplyTo ? { reply_to: emailReplyTo } : {})
      })
    });

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        error: `Resend returned ${response.status}.`
      };
    }

    return {
      attempted: true,
      sent: true,
      error: null
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      error: error instanceof Error ? error.message : 'Email request failed.'
    };
  }
};
