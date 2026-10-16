import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';

const stringValue = (node) =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;
const property = (node, name) =>
  node.properties.find(
    (item) => ts.isPropertyAssignment(item) && item.name.getText() === name
  )?.initializer;

/** Read declared Angular paths without importing browser code or evaluating matchers. */
export function declaredAdminRoutes(sourceText) {
  const source = ts.createSourceFile(
    'admin.routes.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  let declaration;
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'adminRoutes')
      declaration = node.initializer;
    ts.forEachChild(node, find);
  };
  find(source);
  const paths = new Set();
  const visit = (array, prefix) => {
    if (!array || !ts.isArrayLiteralExpression(array))
      throw new Error('Admin route inventory requires literal route arrays.');
    for (const route of array.elements) {
      if (!ts.isObjectLiteralExpression(route))
        throw new Error('Unsupported admin route declaration.');
      const path = stringValue(property(route, 'path'));
      if (path !== undefined) {
        const full = [prefix, path].filter(Boolean).join('/');
        if (property(route, 'loadComponent')) paths.add('/admin/' + full);
        const children = property(route, 'children');
        if (children) visit(children, full);
      } else if (property(route, 'matcher')) {
        // The publication matcher accepts the parent URL and a literal list of spaces.
        const spaces = [];
        const inspect = (node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'includes' &&
            ts.isArrayLiteralExpression(node.expression.expression)
          ) {
            for (const entry of node.expression.expression.elements) {
              const value = stringValue(entry);
              if (!value)
                throw new Error('Admin matcher spaces must be literal paths.');
              spaces.push(value);
            }
          }
          ts.forEachChild(node, inspect);
        };
        inspect(property(route, 'matcher'));
        if (!spaces.length)
          throw new Error(
            'Admin matcher needs an explicit coverage inventory.'
          );
        paths.add('/admin/' + prefix);
        for (const space of spaces) paths.add('/admin/' + prefix + '/' + space);
      } else
        throw new Error('Admin route needs an explicit coverage inventory.');
    }
  };
  visit(declaration, '');
  return [...paths].sort();
}

export function activeAdminScenarios(report, root, config) {
  const scenarios = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      if (!spec.tests?.some((test) => test.expectedStatus === 'passed'))
        continue;
      const file = relative(
        root,
        resolve(report.config.rootDir, spec.file)
      ).replaceAll('\\', '/');
      if (isAbsolute(file) || file.startsWith('../'))
        throw new Error('Coverage scenario is outside the repository.');
      scenarios.push({ file, title: spec.title, config });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return scenarios;
}

/** Metadata links guarantees to selected declarations; assertions still require review. */
export function validateAdminCoverage(registry, routes, scenarios, root) {
  if (
    registry.version !== 1 ||
    !Array.isArray(registry.routes) ||
    !Array.isArray(registry.guarantees)
  )
    throw new Error('Invalid admin coverage registry.');
  if (
    JSON.stringify([...new Set(registry.routes)].sort()) !==
      JSON.stringify([...routes].sort()) ||
    registry.routes.length !== routes.length
  )
    throw new Error('Admin coverage registry differs from declared routes.');
  const ids = new Set();
  for (const item of registry.guarantees) {
    if (!/^A(?:0[1-9]|1[0-8])$/.test(item.id) || ids.has(item.id))
      throw new Error('Invalid or duplicate admin guarantee.');
    ids.add(item.id);
    if (
      !item.routes?.length ||
      item.routes.some((route) => !routes.includes(route)) ||
      !item.roles?.length ||
      item.roles.some(
        (role) => !['owner', 'operator', 'reader', 'anonymous'].includes(role)
      ) ||
      !item.states?.length ||
      item.states.some((state) => typeof state !== 'string' || !state.trim()) ||
      !item.evidence?.length
    )
      throw new Error('Incomplete admin guarantee: ' + item.id);
    let real = false;
    for (const proof of item.evidence) {
      if (
        typeof proof.file !== 'string' ||
        !/^tests\/[\w/.-]+$/.test(proof.file) ||
        proof.file.includes('..')
      )
        throw new Error('Invalid admin evidence path: ' + item.id);
      if (proof.level === 'e2e') {
        const match = scenarios.some(
          (scenario) =>
            scenario.file === proof.file &&
            scenario.title === proof.title &&
            [
              'playwright.config.ts',
              'tests/playwright-identity.config.mjs'
            ].includes(scenario.config)
        );
        if (!match)
          throw new Error(
            'Admin E2E evidence is not selected: ' +
              item.id +
              ' / ' +
              proof.file
          );
        real = true;
      } else if (proof.level === 'unit' && item.id === 'A17') {
        const source = readFileSync(resolve(root, proof.file), 'utf8');
        if (
          !source.includes(JSON.stringify(proof.title)) &&
          !source.includes("'" + proof.title + "'")
        )
          throw new Error('Admin governance unit evidence missing.');
      } else
        throw new Error(
          'Admin guarantee requires real E2E evidence: ' + item.id
        );
    }
    if (item.id !== 'A17' && !real)
      throw new Error('Missing real admin E2E: ' + item.id);
  }
  if (
    routes.some(
      (route) =>
        !registry.guarantees.some((item) => item.routes.includes(route))
    )
  )
    throw new Error('Admin route has no linked guarantee.');
  if (ids.size !== 18)
    throw new Error('Admin coverage must retain all 18 guarantees.');
  return { routes: routes.length, guarantees: ids.size };
}
