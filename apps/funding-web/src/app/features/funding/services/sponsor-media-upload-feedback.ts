import type { SponsorMediaLimits } from '@openg7/funding-core';

interface SponsorMediaFileCandidate {
  readonly size: number;
  readonly type: string;
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

export const getSponsorMediaFileValidationMessage = (
  file: SponsorMediaFileCandidate,
  limits: SponsorMediaLimits
): string => {
  if (file.size === 0) {
    return 'Échec du téléversement : le fichier est vide.';
  }
  if (file.size > limits.maxUploadBytes) {
    return `Échec du téléversement : le fichier dépasse la limite de ${formatSize(limits.maxUploadBytes)}.`;
  }
  if (
    file.type.length > 0 &&
    !limits.acceptedMimeTypes.includes(
      file.type as 'image/jpeg' | 'image/png' | 'image/webp'
    )
  ) {
    return 'Échec du téléversement : choisissez une image JPEG, PNG ou WebP.';
  }
  return '';
};

export const getSponsorMediaUploadFailureMessage = (
  error: unknown,
  limits: SponsorMediaLimits
): string => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('payment') && message.includes('not confirmed')) {
    return "Échec du téléversement : le paiement de cette commandite n'est pas encore confirmé.";
  }
  if (message.includes('too large')) {
    return `Échec du téléversement : le fichier dépasse la limite de ${formatSize(limits.maxUploadBytes)}.`;
  }
  if (
    message.includes('declared image type') ||
    message.includes('valid jpeg') ||
    message.includes('valid token, media kind')
  ) {
    return "Échec du téléversement : le fichier n'est pas une image JPEG, PNG ou WebP valide.";
  }
  if (message.includes('supporting image limit')) {
    return `Échec du téléversement : la limite de ${limits.maxSupportingImages} photos est atteinte.`;
  }
  if (message.includes('approved logo')) {
    return "Échec du téléversement : le logo approuvé doit être remplacé par l'administrateur.";
  }
  if (message.includes('follow-up was not found')) {
    return 'Échec du téléversement : ce lien de suivi est invalide ou expiré.';
  }
  return "Échec du téléversement : le serveur n'a pas pu accepter cette image. Réessayez ou choisissez un autre fichier.";
};
