import type { IncomingMessage, ServerResponse } from 'node:http';

import type { WriteJson } from './contracts.js';

export const sponsorshipRefundConfirmationText = (input: {
  readonly publicReference: string | null;
  readonly id: string;
}): string => input.publicReference ?? input.id;

export const createHttpErrorHelpers = ({
  writeJson
}: {
  readonly writeJson: WriteJson;
}) => {
  const writeSponsorMediaMutationFailure = (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
    status: 'not_found' | 'conflict' | 'approved_locked' | 'not_editable'
  ): void => {
    if (status === 'not_editable') {
      writeJson(request, response, 409, {
        code: 'SPONSORSHIP_NOT_EDITABLE',
        error: 'Sponsorship is not editable.'
      });
      return;
    }
    if (status === 'conflict') {
      writeJson(request, response, 409, {
        code: 'SPONSOR_MEDIA_CONCURRENT_UPDATE',
        error: 'Ce media a ete modifie. Rechargez la fiche puis reessayez.'
      });
      return;
    }
    if (status === 'approved_locked') {
      writeJson(request, response, 409, {
        code: 'SPONSOR_MEDIA_APPROVED',
        error: "Un media approuve doit etre retire par l'administrateur."
      });
      return;
    }
    writeJson(request, response, 404, {
      error: 'Sponsor media was not found.'
    });
  };

  const writeSponsorshipMutationFailure = (
    request: IncomingMessage,
    response: ServerResponse,
    status:
      | 'updated'
      | 'not_found'
      | 'conflict'
      | 'payment_not_eligible'
      | 'media_required',
    details: {
      readonly currentVersion?: string | null;
      readonly paymentStatus?: string | null;
    } = {}
  ): void => {
    if (status === 'conflict') {
      writeJson(request, response, 409, {
        code: 'SPONSORSHIP_CONCURRENT_UPDATE',
        message: 'Cette commandite a ete modifiee par un autre administrateur.',
        currentVersion: details.currentVersion ?? null
      });
      return;
    }

    if (status === 'payment_not_eligible') {
      writeJson(request, response, 409, {
        code: 'SPONSORSHIP_PAYMENT_NOT_ELIGIBLE',
        message:
          'Cette commandite ne peut pas etre publiee ou approuvee lorsque le paiement est rembourse ou conteste.',
        paymentStatus: details.paymentStatus ?? null
      });
      return;
    }

    if (status === 'media_required') {
      writeJson(request, response, 409, {
        code: 'SPONSORSHIP_PRESENTATION_PHOTO_REQUIRED',
        message:
          "Une photo de presentation approuvee est requise avant d'approuver cette commandite."
      });
      return;
    }

    writeJson(request, response, 404, {
      error: 'Sponsorship contribution was not found.'
    });
  };

  const writeSponsorshipRefundIneligible = (
    request: IncomingMessage,
    response: ServerResponse,
    paymentStatus: string | null
  ): void => {
    writeJson(request, response, 409, {
      code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
      message:
        paymentStatus === 'refunded'
          ? 'Cette commandite est deja marquee comme remboursee.'
          : paymentStatus === 'disputed'
            ? 'Cette commandite est contestee; traitez le dossier dans Stripe.'
            : 'Cette commandite ne peut pas etre remboursee automatiquement.',
      paymentStatus
    });
  };

  return {
    writeSponsorMediaMutationFailure,
    writeSponsorshipMutationFailure,
    writeSponsorshipRefundIneligible
  };
};
