/**
 * One-shot codemod: strip `.js` suffix from relative import/export specifiers
 * across `packages/**` and `apps/**`.
 *
 * Why: pre-Turbopack the repo used `extensionAlias` in `webpack(config)` to
 * remap `./foo.js` → `./foo.ts`. Turbopack has no equivalent, so relative
 * imports must drop the `.js` suffix to align with `moduleResolution: bundler`.
 *
 * Scope:
 * - Relative specifiers only (start with `./` or `../`). Cross-package
 *   specifiers (`@mediforce/*`) never carry `.js` today.
 * - `import`, `export ... from`, dynamic `import('…')`, and `typeof
 *   import('…')` constructs.
 * - `.ts` and `.tsx` files only.
 *
 * Safety:
 * - AST-based via ts-morph — never touches string literals, comments, or JSX.
 * - Idempotent — second run is a no-op.
 *
 * Usage:
 *   pnpm add -Dw ts-morph    # one-time, ~5 s
 *   pnpm tsx scripts/migrations/strip-js-extensions.mts --dry-run  # preview
 *   pnpm tsx scripts/migrations/strip-js-extensions.mts            # apply
 *   pnpm typecheck            # verify nothing broke
 *
 * Lifecycle: temporary. Delete this file + drop the ts-morph devDep in a
 * cleanup PR once the open-branch queue has drained (tracked in the
 * Turbopack migration PR description).
 */

import { Project, SyntaxKind } from 'ts-morph';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const project = new Project({
  tsConfigFilePath: path.join(repoRoot, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
});

project.addSourceFilesAtPaths([
  `${repoRoot}/packages/**/*.{ts,tsx}`,
  `${repoRoot}/apps/**/*.{ts,tsx}`,
  `!${repoRoot}/**/node_modules/**`,
  `!${repoRoot}/**/dist/**`,
  `!${repoRoot}/**/.next/**`,
]);

const isRelativeJs = (specifier: string): boolean =>
  (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js');

const stripJs = (specifier: string): string => specifier.slice(0, -3);

let staticCount = 0;
let dynamicCount = 0;
const touchedFiles = new Set<string>();

for (const file of project.getSourceFiles()) {
  let fileTouched = false;

  // `import x from './foo.js'` and `import type x from './foo.js'`
  for (const decl of file.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && isRelativeJs(spec)) {
      decl.setModuleSpecifier(stripJs(spec));
      staticCount++;
      fileTouched = true;
    }
  }

  // `export { x } from './foo.js'` and `export * from './foo.js'`
  for (const decl of file.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && isRelativeJs(spec)) {
      decl.setModuleSpecifier(stripJs(spec));
      staticCount++;
      fileTouched = true;
    }
  }

  // Module-reference helpers in CallExpressions:
  // - Dynamic `import('./foo.js')`
  // - `vi.mock('./foo.js', ...)`, `vi.doMock`, `vi.hoisted`, `vi.importActual`,
  //   `vi.importMock`, `vi.unmock`, `vi.doUnmock`
  // - Same for jest if anyone uses it (harmless if not present).
  // Plus `import('./foo.js')` in type positions (ImportType node).
  const mockerCallees = new Set([
    'vi.mock',
    'vi.doMock',
    'vi.hoisted',
    'vi.importActual',
    'vi.importMock',
    'vi.unmock',
    'vi.doUnmock',
    'jest.mock',
    'jest.doMock',
    'jest.requireActual',
    'jest.requireMock',
  ]);

  file.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression);
      const callee = call.getExpression();
      const isImportCall = callee.getKind() === SyntaxKind.ImportKeyword;
      const isMockerCall = mockerCallees.has(callee.getText());
      if (!isImportCall && !isMockerCall) return;
      const [arg] = call.getArguments();
      if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) return;
      const lit = arg.asKindOrThrow(SyntaxKind.StringLiteral);
      const v = lit.getLiteralValue();
      if (isRelativeJs(v)) {
        lit.setLiteralValue(stripJs(v));
        dynamicCount++;
        fileTouched = true;
      }
    } else if (node.getKind() === SyntaxKind.ImportType) {
      // `import('./foo.js')` used as a type — ts-morph models the argument
      // as a LiteralTypeNode wrapping a StringLiteral.
      const importType = node.asKindOrThrow(SyntaxKind.ImportType);
      const arg = importType.getArgument();
      if (arg.getKind() !== SyntaxKind.LiteralType) return;
      const lit = arg.asKindOrThrow(SyntaxKind.LiteralType).getLiteral();
      if (lit.getKind() !== SyntaxKind.StringLiteral) return;
      const strLit = lit.asKindOrThrow(SyntaxKind.StringLiteral);
      const v = strLit.getLiteralValue();
      if (isRelativeJs(v)) {
        strLit.setLiteralValue(stripJs(v));
        dynamicCount++;
        fileTouched = true;
      }
    }
  });

  if (fileTouched) touchedFiles.add(file.getFilePath());
}

if (!dryRun) {
  await project.save();
}

const mode = dryRun ? 'DRY RUN — no files written' : 'APPLIED';
console.log(
  `[${mode}] Would strip .js from ${staticCount} static + ${dynamicCount} dynamic specifiers across ${touchedFiles.size} files.`,
);

if (dryRun && touchedFiles.size > 0) {
  console.log('\nFirst 20 touched files:');
  [...touchedFiles]
    .slice(0, 20)
    .forEach((p) => console.log('  ' + path.relative(repoRoot, p)));
}

if (staticCount + dynamicCount === 0) {
  console.log('No changes needed — sweep already applied.');
}
