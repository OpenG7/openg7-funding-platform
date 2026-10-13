import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const slash = (path) => path.split(sep).join('/');

function staticCommands(line) {
  const commands = [];
  let words = [],
    word = '',
    started = false,
    quote = null;
  const finishWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === '"') {
      quote = quote ? null : '"';
      started = true;
    } else if (char === "'" && !quote) {
      quote = char;
      started = true;
    } else if (char === '\\') {
      if (index + 1 === line.length)
        throw new Error('Unsupported E2E shell escape.');
      if (!quote || ['$', '`', '"', '\\'].includes(line[index + 1]))
        word += line[++index];
      else word += char;
      started = true;
    } else if (
      char === '`' ||
      (char === '$' && /[\w{(]/.test(line[index + 1] ?? ''))
    ) {
      throw new Error('E2E discovery requires explicit, static CLI arguments.');
    } else if (!quote && char === '&' && line[index + 1] === '&') {
      finishWord();
      if (!words.length) throw new Error('Unsupported E2E shell control flow.');
      commands.push(words);
      words = [];
      index += 1;
    } else if (!quote && /[;|&<>()]/.test(char)) {
      throw new Error('Unsupported E2E shell control flow.');
    } else if (!quote && char === '#' && !started) {
      break;
    } else if (!quote && /\s/.test(char)) finishWord();
    else {
      word += char;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed E2E shell quote.');
  finishWord();
  if (words.length) commands.push(words);
  else if (commands.length)
    throw new Error('Unsupported E2E shell control flow.');
  for (const command of commands) {
    const tokens = command[0] === 'corepack' ? command.slice(1) : command;
    if (
      tokens[0] === 'yarn' ||
      (tokens[0] === 'playwright' && tokens[1] === 'test') ||
      (tokens[0] === 'npx' &&
        tokens[1] === 'playwright' &&
        tokens[2] === 'test') ||
      (tokens[0] === 'node' && tokens[1] === 'scripts/admin-acceptance.mjs')
    )
      continue;
    throw new Error('Unsupported E2E preparation command.');
  }
  return commands;
}

// Scope an if key to its enclosing indentation block (job or list step).
// Only literal true is unconditional; normal artifact/final-check conditions
// have no E2E command in their block and are outside this guard's responsibility.
function assertUnconditionalE2e(source, related) {
  const lines = source.split(/\r?\n/);
  const meaningful = (line) => line.trim() && !line.trim().startsWith('#');
  const indentation = (line) => /^\s*/.exec(line)[0].length;
  for (let index = 0; index < lines.length; index += 1) {
    const condition = /^(\s*)(-\s*)?if:\s*(.*)$/.exec(lines[index]);
    if (!condition) continue;
    const indent = condition[1].length + (condition[2] ? 2 : 0);
    let start = index;
    if (!condition[2]) {
      while (start > 0) {
        start -= 1;
        if (meaningful(lines[start]) && indentation(lines[start]) < indent)
          break;
      }
    }
    const parentIndent = indentation(lines[start]);
    let end = index + 1;
    while (
      end < lines.length &&
      (!meaningful(lines[end]) || indentation(lines[end]) > parentIndent)
    )
      end += 1;
    if (
      related(lines.slice(start, end).join('\n')) &&
      !/^(?:true|\$\{\{\s*true\s*\}\})$/.test(condition[3].trim())
    )
      throw new Error(
        'Conditional E2E jobs or steps require an explicit selection contract.'
      );
  }
}

function assertLinearE2eBlocks(source, related) {
  const lines = source.split(/\r?\n/);
  const meaningful = (line) => line.trim() && !line.trim().startsWith('#');
  const indentation = (line) => /^\s*/.exec(line)[0].length;
  for (let index = 0; index < lines.length; index += 1) {
    const block = /^(\s*)(-\s*)?run:\s*(.+?)\s*$/.exec(lines[index]);
    if (!block) continue;
    const indent = block[1].length + (block[2] ? 2 : 0);
    let end = index + 1;
    while (
      end < lines.length &&
      (!meaningful(lines[end]) || indentation(lines[end]) > indent)
    )
      end += 1;
    const body = lines.slice(index + 1, end);
    if (!related([block[3], ...body.filter(meaningful)].join(' '))) continue;
    if (!/^[|>][0-9+-]*(?:\s+#.*)?$/.test(block[3])) {
      if (body.some(meaningful))
        throw new Error(
          'Multiline E2E run scalars require complete literal commands.'
        );
      continue;
    }
    if (block[3][0] === '>')
      throw new Error(
        'Folded E2E run blocks are unsupported; use complete literal commands.'
      );
    const content = body.filter(meaningful);
    const contentIndent = content.length ? indentation(content[0]) : 0;
    for (const line of content) {
      const command = line.trim();
      if (
        indentation(line) !== contentIndent ||
        /^(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|select|function)\b/.test(
          command
        ) ||
        command.startsWith('-') ||
        command.endsWith('\\')
      )
        throw new Error(
          'Multiline E2E shell control flow or argument continuation is unsupported.'
        );
      staticCommands(command);
    }
  }
}

export function assertDiscoveryArgs(args) {
  if (
    args.some(
      (arg) =>
        arg === '--' || /^--(?:ui|ui-host|ui-port|debug)(?:=|$)/.test(arg)
    )
  )
    throw new Error(
      'E2E discovery forbids CLI terminators and interactive execution modes.'
    );
  if (args.some((arg) => arg.startsWith('-c') && !arg.startsWith('--')))
    throw new Error(
      'E2E discovery requires the explicit --config option; short configuration aliases are unsupported.'
    );
  if (
    args.filter((arg) => arg === '--config' || arg.startsWith('--config='))
      .length > 1
  )
    throw new Error('E2E discovery requires a single configuration option.');
}

// Read the actual CI commands, including Yarn aliases, rather than maintaining
// a second testMatch list. Preserve CLI filters in the discovery invocation.
export function workflowSelections(source, scripts = {}) {
  const selections = new Map();
  const commandLine = (line) => {
    const command = line.trim().replace(/^-?\s*run:\s*/, '');
    return command.startsWith('#') || /^(?:-\s*)?[\w-]+:\s/.test(command)
      ? ''
      : command;
  };
  const e2eAlias = (name, seen = new Set()) => {
    if (!scripts[name] || seen.has(name)) return false;
    if (
      /\bplaywright\s+test\b|\bnode\s+scripts\/admin-acceptance\.mjs\b/.test(
        scripts[name]
      )
    )
      return true;
    const visited = new Set([...seen, name]);
    return [...scripts[name].matchAll(/\byarn\s+([\w:-]+)/g)].some((match) =>
      e2eAlias(match[1], visited)
    );
  };
  const related = (commands) =>
    commands.split(/\r?\n/).some((line) => {
      const command = commandLine(line);
      return (
        /\bplaywright\s+test\b|\bnode\s+scripts\/admin-acceptance\.mjs\b/.test(
          command
        ) ||
        [...command.matchAll(/\byarn\s+([\w:-]+)/g)].some((match) =>
          e2eAlias(match[1])
        )
      );
    });
  const select = (args) => {
    assertDiscoveryArgs(args);
    const index = args.indexOf('--config');
    const config =
      index >= 0
        ? args[index + 1]
        : (args.find((arg) => arg.startsWith('--config='))?.slice(9) ??
          'playwright.config.ts');
    if (!config || config.startsWith('-'))
      throw new Error('Missing E2E configuration path.');
    selections.set(JSON.stringify(args), { config, args });
  };
  const inspect = (commands, forwarded = [], stack = []) => {
    assertUnconditionalE2e(commands, related);
    assertLinearE2eBlocks(commands, related);
    if (
      stack.length &&
      commands.split(/\r?\n/).filter((line) => line.trim()).length > 1
    )
      throw new Error(
        'Multiline E2E Yarn scripts are unsupported; use explicit workflow commands.'
      );
    const segments = commands.split(/\r?\n/).flatMap((line) => {
      const trimmed = commandLine(line);
      if (!related(trimmed)) return [];
      return staticCommands(trimmed);
    });
    if (forwarded.length && !segments.length)
      throw new Error(
        'Cannot forward arguments to an undiscovered E2E script.'
      );
    if (segments.length) segments.at(-1).push(...forwarded);
    for (const words of segments) {
      const tokens = words[0] === 'corepack' ? words.slice(1) : words;
      let cli = tokens;
      if (tokens[0] === 'npx') cli = tokens.slice(1);
      if (
        tokens[0] === 'yarn' &&
        (tokens[1] === 'exec' || tokens[1] === 'playwright')
      )
        cli = tokens.slice(tokens[1] === 'exec' ? 2 : 1);
      if (cli[0] === 'playwright' && cli[1] === 'test') select(cli.slice(2));
      // The disposable recipe runs the default public CLI after its setup.
      // Listing invokes the CLI directly and never the Docker recipe.
      else if (
        tokens[0] === 'node' &&
        tokens[1] === 'scripts/admin-acceptance.mjs'
      )
        select(tokens.slice(2));
      else if (tokens[0] === 'yarn' && e2eAlias(tokens[1])) {
        const name = tokens[1];
        if (stack.includes(name)) throw new Error('Cyclic E2E Yarn alias.');
        inspect(scripts[name], tokens.slice(2), [...stack, name]);
      } else if (related(tokens.join(' ')))
        throw new Error('Unsupported E2E shell command.');
    }
  };
  inspect(source);
  if (!selections.size) throw new Error('The workflow selects no E2E suites.');
  return [...selections.values()];
}

function callParts(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node))
    return [...callParts(node.expression), node.name.text];
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return [...callParts(node.expression), node.argumentExpression.text];
  if (ts.isCallExpression(node)) return callParts(node.expression);
  return [];
}

export function inspectE2eSource(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = new Set(['test']);
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements)
        if ((binding.propertyName ?? binding.name).text === 'test')
          names.add(binding.name.text);
    }
  }
  let declaresTests = false;
  const unfinished = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const parts = callParts(node.expression);
      if (
        names.has(parts[0]) ||
        (namespaces.has(parts[0]) && parts[1] === 'test')
      ) {
        if (parts.length === 1 || parts.includes('describe'))
          declaresTests = true;
        if (['only', 'fixme'].includes(parts.at(-1))) {
          const { line } = source.getLineAndCharacterOfPosition(
            node.getStart(source)
          );
          unfinished.push(
            `${file}:${line + 1}: ${parts.at(-1)} test declaration`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { declaresTests, unfinished };
}

export function collectE2eSources(root) {
  const files = [],
    unfinished = [];
  const walk = (directory) => {
    for (const entry of readdirSync(resolve(root, directory), {
      withFileTypes: true
    })) {
      if (entry.isSymbolicLink()) continue;
      const file = slash(relative(root, resolve(root, directory, entry.name)));
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:spec\.(?:ts|mjs)|ui\.ts)$/.test(entry.name)) {
        const inspection = inspectE2eSource(
          readFileSync(resolve(root, file), 'utf8'),
          file
        );
        unfinished.push(...inspection.unfinished);
        if (/\.spec\./.test(entry.name) || inspection.declaresTests)
          files.push(file);
      }
    }
  };
  walk('tests');
  return { files: files.sort(), unfinished };
}

export function selectedE2eFiles(report, root) {
  if (
    !Array.isArray(report.suites) ||
    !Array.isArray(report.errors) ||
    report.errors.length
  )
    throw new Error(
      'Playwright discovery failed or returned an invalid report.'
    );
  if (typeof report.config?.rootDir !== 'string')
    throw new Error('Playwright discovery omitted its test directory.');
  const files = new Set();
  let active = 0;
  const add = (file) => {
    if (typeof file !== 'string' || !file) return;
    const path = slash(relative(root, resolve(report.config.rootDir, file)));
    if (path === '..' || path.startsWith('../') || isAbsolute(path))
      throw new Error('Playwright selected a test outside the repository.');
    files.add(path);
  };
  const walk = (suite) => {
    let selected = 0;
    for (const spec of suite.specs ?? []) {
      if (!Array.isArray(spec.tests))
        throw new Error('Invalid discovered test.');
      if (
        spec.tests.some(
          (test) =>
            !['passed', 'failed', 'skipped'].includes(test.expectedStatus)
        )
      )
        throw new Error('Invalid discovered test status.');
      if (
        spec.tests.some((test) =>
          test.annotations?.some((annotation) => annotation.type === 'fixme')
        )
      )
        throw new Error('Playwright selected an unfinished test.');
      if (spec.tests.some((test) => test.expectedStatus !== 'skipped')) {
        add(spec.file);
        selected += 1;
        active += 1;
      }
    }
    for (const child of suite.suites ?? []) selected += walk(child);
    if (selected) add(suite.file);
    return selected;
  };
  for (const suite of report.suites) walk(suite);
  if (!active) throw new Error('The E2E suite selects no active tests.');
  return { files, active };
}

export function e2eSelectionGaps(expected, selected) {
  return expected.filter((file) => !selected.has(file));
}
