import type {
  BoutiqueProduct,
  BoutiqueUniverse
} from '../models/boutique-product.model.js';

export const BOUTIQUE_UNIVERSES = [
  'dragons',
  'princesses',
  'unicorns'
] as const satisfies readonly BoutiqueUniverse[];

// Display order follows this array. See docs/boutique-products.md to add photos.
// Leave unknown images, prices and product links null until they are confirmed.
export const BOUTIQUE_FEATURED_PRODUCTS: readonly BoutiqueProduct[] = [
  {
    id: 'dragon-01',
    universe: 'dragons',
    titleKey: 'funding.boutique.featured.items.dragons.title',
    descriptionKey: 'funding.boutique.featured.items.dragons.description',
    image: null,
    price: null,
    productUrl: null,
    availability: 'coming-soon'
  },
  {
    id: 'princess-01',
    universe: 'princesses',
    titleKey: 'funding.boutique.featured.items.princesses.title',
    descriptionKey: 'funding.boutique.featured.items.princesses.description',
    image: null,
    price: null,
    productUrl: null,
    availability: 'coming-soon'
  },
  {
    id: 'unicorn-01',
    universe: 'unicorns',
    titleKey: 'funding.boutique.featured.items.unicorns.title',
    descriptionKey: 'funding.boutique.featured.items.unicorns.description',
    image: null,
    price: null,
    productUrl: null,
    availability: 'coming-soon'
  }
];
