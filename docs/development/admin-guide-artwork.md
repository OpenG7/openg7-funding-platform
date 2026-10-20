# Illustrations décoratives du Guide administratif

Le Guide utilise deux illustrations générées avec l’outil intégré **imagegen**
le 19 octobre 2026. Elles accompagnent le rail et l’en-tête ; elles ne représentent
aucun dossier, commanditaire ou fait financier. Les textes et contrôles restent
des éléments HTML indépendants.

| Asset                                                                                 | Dimensions  | Taille         | Usage                           |
| ------------------------------------------------------------------------------------- | ----------- | -------------- | ------------------------------- |
| [Panorama](../../apps/funding-web/src/assets/admin-guide-panorama.webp)               | 2172 × 724  | 233 198 octets | Fond discret de l’en-tête       |
| [Princesse et lion](../../apps/funding-web/src/assets/admin-guide-princess-lion.webp) | 1024 × 1536 | 231 506 octets | Illustration décorative du rail |

Les fichiers WebP proviennent des PNG générés, compressés avec `sharp` déjà
présent dans le workspace, sans redimensionnement. Aucun texte ni élément
d’interface n’est intégré aux illustrations. Le portrait possède un texte
alternatif vide, est masqué aux technologies d’assistance et disparaît lorsque
l’espace manque. Le panorama est un fond CSS.

La référence de style est la maquette de prévisualisation retenue dans la
conversation : montagnes canadiennes, bleu, blanc et doré modéré, princesse et
lion blanc. Les illustrations ne constituent pas une capture de l’application.

## Prompt du panorama

```text
Use case: stylized-concept
Asset type: Decorative raster banner for an administrative web guide, wide horizontal panorama, 3:1 aspect ratio.
Primary request: Generate a separate clean panoramic artwork inspired by the natural Canadian background at the top of the supplied reference UI. Only the scenery, never the interface.
Input images: provided local reference is STYLE AND SCENERY inspiration only, not an edit target.
Scene/backdrop: Elegant Canadian alpine landscape, soft blue snowcapped mountains stretching across the horizon, turquoise lake, evergreen forests, a subtle graceful Canadian city skyline and a small distant Parliament-inspired stone tower at the far right. No flags required.
Style/medium: luminous refined fantasy illustration with restrained detail, soft painterly realism matching the reference's blue, white and muted gold palette.
Composition/framing: ultra wide 3:1 composition, mountain horizon at upper third, lake and forest lower third; all forms readable in a shallow banner crop. Balanced distant city very subtle, no prominent foreground objects. Full image is scenery.
Lighting/mood: tranquil clear daytime, airy pale blue sky, soft warm sunlight, minimal visual noise.
Constraints: no UI, no text, no letters, no logos, no watermark, no borders, no people, no character, no screen or mockup. Suitable as a discreet decorative image in an admin panel.
```

## Prompt du portrait

```text
Use case: stylized-concept
Asset type: Decorative portrait raster illustration for the lower part of an administrative web-guide navigation rail, portrait 2:3 aspect ratio.
Primary request: Create a clean standalone illustration of the blonde adult princess and majestic white lion from the reference, keeping the refined luminous blue, white and muted gold atmosphere. This is decorative artwork only, never a UI screenshot.
Input images: supplied reference UI is character and style inspiration only; recreate only the princess with her white lion as a new separate portrait artwork.
Scene/backdrop: Soft distant Canadian alpine mountains, pale sky, turquoise lake and very subtle elegant castle architecture. Airy, subdued backdrop, softly fading detail at the top so it blends with a pale-blue panel.
Subject: A calm adult blonde princess wearing a delicate gold crown, elegant royal blue gown with understated gold embroidery and white skirt, beside a gentle majestic white lion with a flowing pale mane. Princess at left and lion at right, both facing slightly right, friendly composed expressions, no weapons.
Style/medium: elegant painterly fantasy illustration, refined and softly realistic, restrained detail and contrast, matching the supplied mockup.
Composition/framing: vertical 2:3 full portrait, princess and lion from waist upward, comfortably together in the lower two thirds. The upper third is a quiet airy pale-blue mountain atmosphere. Keep all faces and crown within frame, no text, no interface.
Lighting/mood: soft daylight, serene, reassuring, discreet decorative presence.
Color palette: muted royal blue, creamy white, soft antique gold, pale blue. Avoid intense saturated colors.
Constraints: no text, no letters, no UI, no logo, no watermark, no border, no screen, no extra characters, no flags.
```
