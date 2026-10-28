import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const directory = 'apps/funding-web/src/app/features/funding/service-delivery/';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const feature = path.resolve(workspace, directory);
const nginx = read('apps/funding-web/nginx.conf');
const location = nginx.match(/location ~ (\^\/demo\/prestations[^\n]+) \{/);

function* sourceFiles(directoryPath) {
  const ignored = new Set(['node_modules', 'dist', '.angular', 'coverage']);
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const filename = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name))
      yield* sourceFiles(filename);
    else if (entry.isFile() && /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name))
      yield filename;
  }
}

function inside(directoryPath, filename) {
  const relative = path.relative(directoryPath, filename);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative))
  );
}

function moduleReferences(source) {
  const references = [];
  const add = (node) => {
    if (
      node &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    )
      references.push({
        specifier: node.text,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    else if (ts.isExternalModuleReference(node)) add(node.expression);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

function property(object, name) {
  return object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
      candidate.name.text === name
  )?.initializer;
}

test('the static host serves every declared synthetic service destination', () => {
  assert.ok(location, 'the demo has an explicit client routing location');
  const accepts = new RegExp(location[1]);
  const ids = [
    ...read(directory + 'service-demo-state.ts').matchAll(/id: '([^']+)'/g)
  ].map((match) => match[1]);
  const catalog = read(directory + 'service-demo-detail.component.ts').match(
    /export const DEMO_DETAIL_PAGES = \[([\s\S]*?)\] as const;/
  );
  assert.ok(catalog, 'the declared demo destination catalog is available');
  const details = [...catalog[1].matchAll(/path: '([^']+)'/g)].map(
    (match) => match[1]
  );
  assert.equal(ids.length, 3);
  assert.equal(details.length, 33);
  assert.ok(accepts.test('/demo/prestations'));
  for (const id of ids) {
    const base = '/demo/prestations/dossier/' + id;
    for (const page of [
      '',
      'contenu',
      'autorisation',
      'publication',
      'historique',
      'corriger',
      ...details,
      ...['texte', 'image', 'liens', 'mentions', 'options'].map(
        (tab) => 'corriger/' + tab
      )
    ]) {
      const url = base + (page ? '/' + page : '');
      assert.ok(accepts.test(url), url);
      assert.ok(accepts.test(url + '/'), url + '/');
    }
  }
});

test('unknown files, tabs, descendants and prefix collisions remain HTTP 404s', () => {
  const accepts = new RegExp(location[1]);
  for (const path of [
    '/demo/prestations-extra',
    '/demo/prestations/inconnu',
    '/demo/prestations/dossier/inconnu/contenu',
    '/demo/prestations/dossier/atelier-boreal/inconnu',
    '/demo/prestations/dossier/atelier-boreal/contenu/extra',
    '/demo/prestations/dossier/atelier-boreal/corriger/inconnu',
    '/demo/prestations/dossier/atelier-boreal/corriger/texte/extra'
  ])
    assert.equal(accepts.test(path), false, path);
});

test('service delivery exposes only its lazy route entry point to external callers', () => {
  const config = ts.readConfigFile(
    path.join(workspace, 'tsconfig.json'),
    ts.sys.readFile
  );
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    workspace
  );
  assert.deepEqual(parsed.errors, []);
  const options = { ...parsed.options, resolveJsonModule: true };
  const canonical = ts.sys.useCaseSensitiveFileNames
    ? (filename) => path.resolve(filename)
    : (filename) => path.resolve(filename).toLowerCase();
  const entryPoint = path.join(feature, 'index.ts');
  const cache = ts.createModuleResolutionCache(workspace, canonical, options);
  const violations = [];

  for (const root of ['apps', 'packages', 'scripts', 'tests']) {
    for (const filename of sourceFiles(path.join(workspace, root))) {
      if (inside(feature, filename)) continue;
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      for (const { specifier, line } of moduleReferences(source)) {
        const resolved = ts.resolveModuleName(
          specifier,
          filename,
          options,
          ts.sys,
          cache
        ).resolvedModule?.resolvedFileName;
        const target =
          resolved ??
          (specifier.startsWith('.') || path.isAbsolute(specifier)
            ? path.resolve(path.dirname(filename), specifier)
            : undefined);
        if (
          target &&
          inside(feature, target) &&
          canonical(target) !== canonical(entryPoint)
        )
          violations.push(
            `${path.relative(workspace, filename)}:${line}: ${specifier}`
          );
      }
    }
  }
  assert.deepEqual(
    violations.sort(),
    [],
    'External callers must import the service-delivery index, never its internals.'
  );

  // Bind only the entry point: inspect its public API without loading Angular,
  // executing the feature or pulling its dependencies into the Node test.
  const program = ts.createProgram([entryPoint], {
    ...options,
    noResolve: true,
    noLib: true,
    types: []
  });
  const source = program.getSourceFile(entryPoint);
  assert.ok(source, 'the lazy feature entry point exists');
  assert.ok(
    !source.statements.some(
      (statement) =>
        ts.isExportDeclaration(statement) && !statement.exportClause
    ),
    'Wildcard exports would expose private feature implementation.'
  );
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  assert.ok(module, 'the entry point is an ES module');
  assert.deepEqual(
    checker
      .getExportsOfModule(module)
      .map((symbol) => symbol.getName())
      .sort(),
    ['serviceDeliveryRoutes']
  );
});

test('service delivery owns one draft scope and departure guard on its shell route', () => {
  const source = ts.createSourceFile(
    'service-delivery.routes.ts',
    read(directory + 'service-delivery.routes.ts'),
    ts.ScriptTarget.Latest,
    true
  );
  const draftScopes = [];
  const guardedRoutes = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const providers = property(node, 'providers');
      if (
        providers &&
        ts.isArrayLiteralExpression(providers) &&
        providers.elements.some(
          (provider) =>
            ts.isIdentifier(provider) && provider.text === 'ServiceDemoState'
        )
      )
        draftScopes.push(node);
      if (property(node, 'canDeactivate')) guardedRoutes.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(
    draftScopes.length,
    1,
    'drafts have one scope across all child pages'
  );
  const shell = draftScopes[0];
  const component = property(shell, 'component');
  assert.ok(
    component &&
      ts.isIdentifier(component) &&
      component.text === 'ServiceDemoShellComponent'
  );
  const routePath = property(shell, 'path');
  assert.ok(
    routePath && ts.isStringLiteral(routePath) && routePath.text === ''
  );
  const children = property(shell, 'children');
  assert.ok(children && ts.isArrayLiteralExpression(children));
  const guard = property(shell, 'canDeactivate');
  assert.ok(
    guard && ts.isArrayLiteralExpression(guard) && guard.elements.length > 0
  );
  assert.ok(
    guardedRoutes.length === 1 && guardedRoutes[0] === shell,
    'only leaving the shell asks for confirmation'
  );
});
