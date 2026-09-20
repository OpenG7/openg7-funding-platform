export type BoutiqueUniverse = 'dragons' | 'princesses' | 'unicorns';

/** Editorial product card. Prices are display-only; NorthDragon handles orders. */
export interface BoutiqueProduct {
  readonly id: string;
  readonly universe: BoutiqueUniverse;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly image: {
    readonly src: string;
    readonly altKey: string;
    readonly fit?: 'contain' | 'cover';
  } | null;
  readonly price: {
    readonly amountMinor: number;
    readonly currency: 'CAD';
  } | null;
  readonly productUrl: string | null;
  readonly availability: 'coming-soon' | 'available' | 'sold-out';
}
