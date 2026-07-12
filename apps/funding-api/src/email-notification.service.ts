interface SponsorshipFollowupEmailInput {
  readonly to: string;
  readonly followupUrl: string;
}

interface PublicationBatchFullEmailInput {
  readonly channel: string;
  readonly capacity: number;
}

interface EmailSendResult {
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly error: string | null;
}

const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? '';
const emailFrom = process.env.FUNDING_EMAIL_FROM?.trim() ?? '';
const emailReplyTo = process.env.FUNDING_EMAIL_REPLY_TO?.trim() ?? '';
const adminNotificationEmail =
  process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? '';

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

/**
 * Notifies the configured admin address when a publication batch reaches
 * capacity, so it gets scheduled or published instead of sitting full and
 * unnoticed. Purely informational: it never schedules or publishes anything
 * itself.
 */
export const sendPublicationBatchFullNotification = async (
  input: PublicationBatchFullEmailInput
): Promise<EmailSendResult> => {
  if (!resendApiKey || !emailFrom || !adminNotificationEmail) {
    return {
      attempted: false,
      sent: false,
      error: 'Email provider or admin notification address is not configured.'
    };
  }

  const channelLabel = escapeHtml(input.channel);
  const subject = `Lot ${input.channel} complet (${input.capacity}/${input.capacity})`;
  const text = [
    `Un lot de publication collective ${input.channel} a atteint sa capacite (${input.capacity}/${input.capacity}).`,
    '',
    'Planifiez ou publiez ce lot depuis /admin/fundraiser/publications, ou creez un nouveau lot pour les prochaines commandites approuvees.'
  ].join('\n');
  const html = `
    <p>
      Un lot de publication collective <strong>${channelLabel}</strong> a
      atteint sa capacite (${input.capacity}/${input.capacity}).
    </p>
    <p>
      Planifiez ou publiez ce lot depuis
      <code>/admin/fundraiser/publications</code>, ou creez un nouveau lot
      pour les prochaines commandites approuvees.
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
        to: [adminNotificationEmail],
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
