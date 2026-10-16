import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import ts from 'typescript';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
export const mappings = {
  'tokens/themes': {
    tailwind: '@theme inline : --color-*, --font-*, --spacing-*',
    guidance:
      'Conserver les variables et thèmes métier; exposer les tokens dans Tailwind.'
  },
  layout: {
    tailwind:
      'flex, grid, items-*, justify-*, gap-*, relative, absolute, overflow-*',
    guidance:
      'Utilitaires Tailwind pour la structure; composants Angular pour les assemblages répétés.'
  },
  'spacing/sizing': {
    tailwind: 'm-*, p-*, w-*, h-*, min-w-*, max-w-*, size-*',
    guidance:
      'Utiliser une échelle partagée; vérifier les valeurs avant remplacement.'
  },
  typography: {
    tailwind: 'font-*, text-*, leading-*, tracking-*, whitespace-*',
    guidance:
      'Conserver les choix éditoriaux et les préférences typographiques.'
  },
  'surfaces/borders': {
    tailwind: 'bg-*, border-*, rounded-*, shadow-*, opacity-*',
    guidance:
      'Mapper les couleurs vers les tokens; conserver les médias et effets spécifiques.'
  },
  motion: {
    tailwind: 'transition-*, duration-*, ease-*, animate-*, motion-reduce:*',
    guidance:
      'Garder les keyframes spécifiques et respecter la réduction des animations.'
  },
  interaction: {
    tailwind:
      'cursor-*, pointer-events-*, select-*, hover:*, focus-visible:*, disabled:*',
    guidance:
      'CDK A11y, Dialog ou Overlay pour les comportements; Material seulement pour un composant complet retenu.'
  },
  autre: {
    tailwind: 'Propriété arbitraire [propriété:valeur] après revue',
    guidance: 'Analyser le besoin; aucun remplacement automatique.'
  }
};
const families = [
  [
    'layout',
    /^(display|position|inset|top$|right$|bottom$|left$|z-index|float|clear|flex|grid|align|justify|place|gap$|row-gap|column-gap|order$|overflow|columns?$|column-(count|width|fill|span)|isolation|table-layout)/
  ],
  [
    'spacing/sizing',
    /^(margin|padding|width$|height$|size$|min-|max-|inline-size|block-size|aspect-ratio|box-sizing)/
  ],
  [
    'typography',
    /^(font|text-|line-height|letter-spacing|word-|white-space|color$|vertical-align|list-style|hyphens|tab-size)/
  ],
  [
    'surfaces/borders',
    /^(background|border|outline|box-shadow|fill|stroke|opacity|filter|backdrop-filter|mix-blend|object-|clip|mask)/
  ],
  [
    'motion',
    /^(animation|transition|transform|translate|rotate|scale|will-change|perspective|backface)/
  ],
  [
    'interaction',
    /^(cursor|pointer-events|user-select|touch-action|appearance|caret-color|accent-color|scroll-|resize)/
  ]
];
const ordered = (object) =>
  Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => a.localeCompare(b, 'en'))
  );
const increment = (object, key, amount = 1) => {
  object[key] = (object[key] ?? 0) + amount;
};
const scopeOf = (path) =>
  /(^|\/)styles(?:\/|\.css$)/.test(path)
    ? 'global'
    : /(^|\/)(admin[-/]|api-keys-|webhooks-|stripe-setup-)/.test(path)
      ? 'admin'
      : 'public';
const emptyStats = () => ({
  styleBlocks: 0,
  rules: 0,
  selectors: 0,
  declarations: 0,
  mediaRules: 0,
  keyframes: 0,
  applyRules: 0,
  applyUtilities: 0,
  referenceRules: 0,
  importRules: 0,
  tokenDefinitions: 0,
  tokenUsages: 0,
  properties: Object.create(null),
  states: Object.create(null),
  utilities: Object.create(null),
  families: Object.fromEntries(Object.keys(mappings).map((key) => [key, 0]))
});
function combine(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') target[key] += value;
    else
      for (const [name, count] of Object.entries(value))
        increment(target[key], name, count);
  }
}
function finish(stats) {
  return {
    ...stats,
    uniqueProperties: Object.keys(stats.properties).length,
    uniqueStates: Object.keys(stats.states).length,
    uniqueApplyUtilities: Object.keys(stats.utilities).length,
    properties: ordered(stats.properties),
    states: ordered(stats.states),
    utilities: ordered(stats.utilities)
  };
}
function analyze(css, path, line) {
  const stats = emptyStats();
  stats.styleBlocks = 1;
  let tree;
  try {
    tree = postcss.parse(css, { from: path });
  } catch (error) {
    throw new Error(
      `${path}:${line + (error.line ?? 1) - 1}:${error.column ?? 1}: ${error.reason ?? error.message}`
    );
  }
  tree.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'media') stats.mediaRules++;
    if (name === 'reference') stats.referenceRules++;
    if (name === 'import') stats.importRules++;
    if (name === 'apply') {
      stats.applyRules++;
      for (const utility of postcss.list.space(rule.params)) {
        if (utility === '!important') continue;
        stats.applyUtilities++;
        increment(stats.utilities, utility);
      }
    }
    if (/^(?:-\w+-)?keyframes$/i.test(rule.name)) stats.keyframes++;
  });
  tree.walkRules((rule) => {
    stats.rules++;
    for (let node = rule.parent; node; node = node.parent)
      if (node.type === 'atrule' && /keyframes$/i.test(node.name)) return;
    stats.selectors += postcss.list.comma(rule.selector).length;
    for (const state of rule.selector.match(
      /:{1,2}[\w-]+|\[(?:disabled|checked|selected|open|aria-[\w-]+|data-state)(?:[^\]]*)\]/g
    ) ?? [])
      increment(stats.states, state);
  });
  tree.walkDecls((declaration) => {
    const property = declaration.prop.startsWith('--')
      ? declaration.prop
      : declaration.prop.toLowerCase();
    const family = property.startsWith('--')
      ? 'tokens/themes'
      : (families.find(([, pattern]) => pattern.test(property))?.[0] ??
        'autre');
    stats.declarations++;
    increment(stats.properties, property);
    stats.families[family]++;
    if (property.startsWith('--')) stats.tokenDefinitions++;
    stats.tokenUsages += (declaration.value.match(/\bvar\s*\(/g) ?? []).length;
  });
  return stats;
}
async function walk(directory) {
  const paths = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name, 'en')
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (
      entry.isFile() &&
      /\.(css|ts)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    )
      paths.push(path);
  }
  return paths;
}
function componentStyles(text, path, ignored) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) {
    const diagnostic = file.parseDiagnostics[0];
    const location = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new Error(
      `${path}:${location.line + 1}:${location.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
    );
  }
  const bindings = new Set();
  const namespaces = new Set();
  for (const node of file.statements)
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === '@angular/core'
    ) {
      const imported = node.importClause?.namedBindings;
      if (imported && ts.isNamespaceImport(imported))
        namespaces.add(imported.name.text);
      if (imported && ts.isNamedImports(imported))
        for (const binding of imported.elements)
          if ((binding.propertyName ?? binding.name).text === 'Component')
            bindings.add(binding.name.text);
    }
  const blocks = [];
  const handled = new Set();
  const literal = (node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const skip = (node, reason) =>
    ignored.push({
      path,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      reason
    });
  function visit(node) {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      const name = call.expression;
      const isComponent =
        (ts.isIdentifier(name) && bindings.has(name.text)) ||
        (ts.isPropertyAccessExpression(name) &&
          ts.isIdentifier(name.expression) &&
          namespaces.has(name.expression.text) &&
          name.name.text === 'Component');
      if (isComponent) {
        const metadata = call.arguments[0];
        if (!metadata || !ts.isObjectLiteralExpression(metadata))
          skip(node, 'Métadonnées Component dynamiques ignorées');
        else
          for (const property of metadata.properties) {
            if (ts.isSpreadAssignment(property)) {
              skip(
                property,
                'Fragment de métadonnées Component dynamique ignoré'
              );
              continue;
            }
            const key =
              property.name &&
              (ts.isIdentifier(property.name) ||
                ts.isStringLiteral(property.name))
                ? property.name.text
                : '';
            if (!['styles', 'styleUrl', 'styleUrls'].includes(key)) continue;
            handled.add(property);
            if (!ts.isPropertyAssignment(property)) {
              skip(property, `${key} dynamique ignoré`);
              continue;
            }
            const value = property.initializer;
            const values = ts.isArrayLiteralExpression(value)
              ? value.elements
              : [value];
            for (const item of values) {
              if (!literal(item)) {
                skip(item, `${key} dynamique ignoré`);
                continue;
              }
              if (key === 'styles')
                blocks.push({
                  css: item.text,
                  line:
                    file.getLineAndCharacterOfPosition(item.getStart(file))
                      .line + 1
                });
            }
          }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  function findIgnored(node) {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      !handled.has(node) &&
      node.name &&
      ['styles', 'styleUrl', 'styleUrls'].includes(node.name.text)
    )
      skip(node, 'Propriété hors décorateur Angular Component ignorée');
    ts.forEachChild(node, findIgnored);
  }
  findIgnored(file);
  return blocks;
}

export async function inventory(root = sourceRoot) {
  const totals = emptyStats();
  const scopes = Object.fromEntries(
    ['admin', 'public', 'global'].map((scope) => [scope, emptyStats()])
  );
  const files = [];
  const ignored = [];
  for (const absolute of await walk(root)) {
    const path = `src/${relative(root, absolute).replaceAll('\\', '/')}`;
    const text = await readFile(absolute, 'utf8');
    const kind = path.endsWith('.css') ? 'external' : 'inline';
    const blocks =
      kind === 'external'
        ? [{ css: text, line: 1 }]
        : componentStyles(text, path, ignored);
    if (!blocks.length) continue;
    const scope = scopeOf(path);
    const stats = emptyStats();
    const analyzed = blocks.map(({ css, line }) => {
      const block = analyze(css, path, line);
      combine(stats, block);
      return { line, ...finish(block) };
    });
    combine(totals, stats);
    combine(scopes[scope], stats);
    files.push({ path, kind, scope, ...finish(stats), blocks: analyzed });
  }
  return {
    root: 'src',
    limitations: [
      'Inventaire des sources : déclarations écrites dans les CSS et styles littéraux Component uniquement; aucune compilation des imports, du framework ou de node_modules.',
      'Les propriétés CSS produites par @apply ne sont pas comptées comme déclarations écrites; applyUtilities compte les occurrences d’utilitaires sans expansion.',
      'Attributs de template style= et liaisons [style.*] non analysés.',
      'Les références dynamiques et les propriétés styles hors Component sont ignorées et détaillées dans ignored.'
    ],
    scopeMethod:
      'Étiquette inférée du chemin : styles = global; admin-*, api-keys-*, webhooks-*, stripe-setup-* = admin; autres = public.',
    totals: {
      files: files.length,
      externalFiles: files.filter((file) => file.kind === 'external').length,
      inlineFiles: files.filter((file) => file.kind === 'inline').length,
      ...finish(totals)
    },
    scopes: Object.fromEntries(
      Object.entries(scopes).map(([scope, stats]) => [scope, finish(stats)])
    ),
    mappings,
    files,
    ignored
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !['--json', '--help'].includes(arg)))
      throw new Error('Option inconnue. Utiliser --json ou --help.');
    if (args.includes('--help'))
      console.log(
        'Inventaire CSS en lecture seule : css:inventory [--json]. Analyse src/**/*.css et les styles littéraux des Component Angular; aucune écriture ni requête réseau.'
      );
    else {
      const report = await inventory();
      if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
      else {
        const total = report.totals;
        console.log(
          `Inventaire CSS : ${total.files} fichiers (${total.externalFiles} CSS externes, ${total.inlineFiles} composants avec styles inline), ${total.styleBlocks} blocs.`
        );
        console.log(
          `${total.declarations} déclarations écrites, ${total.uniqueProperties} propriétés distinctes, ${total.rules} règles, ${total.selectors} sélecteurs, ${total.uniqueStates} états/pseudo-sélecteurs distincts.`
        );
        console.log(
          `${total.tokenDefinitions} définitions de tokens, ${total.tokenUsages} usages var(), ${total.mediaRules} @media, ${total.keyframes} @keyframes.`
        );
        console.log(
          `${total.applyRules} @apply (${total.applyUtilities} occurrences d’utilitaires, ${total.uniqueApplyUtilities} distincts), ${total.referenceRules} @reference, ${total.importRules} @import.`
        );
        for (const [family, count] of Object.entries(total.families))
          console.log(`- ${family} : ${count} → ${mappings[family].tailwind}`);
        for (const [scope, stats] of Object.entries(report.scopes))
          console.log(`- ${scope} : ${stats.declarations} déclarations`);
        console.log(
          `${report.ignored.length} référence(s) ignorée(s); détails, limites des étiquettes et correspondances dans --json.`
        );
        for (const item of report.ignored)
          console.log(`- ${item.path}:${item.line} : ${item.reason}`);
        console.log(
          'Sources uniquement : imports et @apply non compilés; propriétés générées par @apply exclues des déclarations. Attributs style= et [style.*] des templates non analysés.'
        );
      }
    }
  } catch (error) {
    console.error(
      `Inventaire CSS impossible : ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
