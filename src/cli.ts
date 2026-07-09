#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { addBarrelExport } from './barrelUpdater';
import { componentTypeLabels } from './stacks/componentBlueprint';
import { detectConventions, SiblingComponent } from './conventions';
import { templates, stackLabels } from './stacks/registry';
import { detectStackFromDeps } from './stacks/stackFromDeps';
import { FieldKind, FieldSpec, fieldKindLabels } from './stacks/fieldSpec';
import { ComponentType, GeneratorOptions, Stack, StyleLib, toKebabCase, toPascalCase } from './stacks/types';
import { detectStyleLibFromDeps } from './styleLibDetector';

function findNearestPackageJsonDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function readDeps(dir: string): Record<string, string> {
  const pkgDir = findNearestPackageJsonDir(dir);
  if (!pkgDir) {
    return {};
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

function tryReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function scanSiblingComponents(targetDir: string): SiblingComponent[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const siblings: SiblingComponent[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).slice(0, 8)) {
    const folderPath = path.join(targetDir, entry.name);
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(folderPath).filter((f) => fs.statSync(path.join(folderPath, f)).isFile());
    } catch {
      continue;
    }
    if (fileNames.length === 0) {
      continue;
    }

    const mainFileName = fileNames.find(
      (f) => !f.includes('.test.') && !f.includes('.spec.') && !/\.(css|scss|html)$/.test(f),
    );
    const testFileName = fileNames.find((f) => f.includes('.test.') || f.includes('.spec.'));

    siblings.push({
      folderName: entry.name,
      fileNames,
      mainFileContent: mainFileName ? tryReadText(path.join(folderPath, mainFileName)) : null,
      testFileContent: testFileName ? tryReadText(path.join(folderPath, testFileName)) : null,
    });
  }
  return siblings;
}

function buildBarrelExportLine(stack: Stack, componentName: string, options: GeneratorOptions): string {
  switch (stack) {
    case 'react': {
      const importPath = options.fileNaming === 'index' ? `./${componentName}` : `./${componentName}/${componentName}`;
      return options.exportStyle === 'named'
        ? `export { ${componentName} } from '${importPath}';`
        : `export { default as ${componentName} } from '${importPath}';`;
    }
    case 'vue': {
      const fileName = options.fileNaming === 'index' ? 'index.vue' : `${componentName}.vue`;
      return `export { default as ${componentName} } from './${componentName}/${fileName}';`;
    }
    case 'svelte': {
      const fileName = options.fileNaming === 'index' ? 'index.svelte' : `${componentName}.svelte`;
      return `export { default as ${componentName} } from './${componentName}/${fileName}';`;
    }
    case 'angular': {
      const base = toKebabCase(componentName);
      return `export { ${componentName}Component } from './${componentName}/${base}.component';`;
    }
  }
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value ?? 'true';
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printUsage(): void {
  console.log(`Usage: generate-component <name> [targetDir] [options]

Options:
  --stack=react|vue|svelte|angular|auto    (default: auto-detected from package.json)
  --type=blank|button|modal|form|list      (default: blank)
  --fields=name:kind,name:kind             Custom fields for --type=form|list
                                            (kinds: ${Object.keys(fieldKindLabels).join('|')})
  --style-lib=auto|plain|tailwind|styled-components|emotion|chakra-ui|mui (default: auto)
  --style-format=css-module|scss-module|css|scss|none (default: css-module)
  --file-naming=index|componentName        (default: index)
  --export-style=named|default             (default: named)
  --test-framework=jest|vitest             (default: jest)
  --no-test                                Skip generating a test file
  --help                                   Show this message
`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseFieldsFlag(raw: string | undefined): FieldSpec[] {
  if (!raw) {
    return [];
  }
  return raw.split(',').map((entry) => {
    const [name, kind] = entry.split(':').map((s) => s?.trim());
    if (!name || !kind) {
      fail(`invalid --fields entry "${entry}", expected name:kind`);
    }
    if (!(kind in fieldKindLabels)) {
      fail(`unknown field kind "${kind}" in --fields (expected one of ${Object.keys(fieldKindLabels).join('|')})`);
    }
    return { name, kind: kind as FieldKind };
  });
}

export function run(argv: string[]): void {
  const { positional, flags } = parseArgs(argv);

  if (flags.help !== undefined || positional.length === 0) {
    printUsage();
    return;
  }

  const [rawName, targetDirArg] = positional;
  const targetDir = path.resolve(targetDirArg ?? process.cwd());

  if (!fs.existsSync(targetDir)) {
    fail(`target directory does not exist: ${targetDir}`);
  }

  const deps = readDeps(targetDir);

  const stackFlag = flags.stack as Stack | undefined;
  const stack = stackFlag && stackFlag !== ('auto' as string) ? stackFlag : detectStackFromDeps(deps);
  if (!stack || !(stack in templates)) {
    fail('could not detect a stack from package.json — pass --stack=react|vue|svelte|angular explicitly');
  }

  const componentType = (flags.type ?? 'blank') as ComponentType;
  if (!(componentType in componentTypeLabels)) {
    fail(`unknown component type "${componentType}"`);
  }

  const fields = parseFieldsFlag(flags.fields);
  if (fields.length > 0 && componentType !== 'form' && componentType !== 'list') {
    console.warn(`Warning: --fields is ignored for --type=${componentType} (only form/list use it)`);
  }

  const componentName = toPascalCase(rawName);
  if (!componentName) {
    fail(`could not derive a valid component name from "${rawName}"`);
  }

  const componentFolder = path.join(targetDir, componentName);
  if (fs.existsSync(componentFolder)) {
    fail(`a folder named "${componentName}" already exists in ${targetDir}`);
  }

  const baseOptions = {
    styleFormat: (flags['style-format'] ?? 'css-module') as GeneratorOptions['styleFormat'],
    generateTest: flags['no-test'] === undefined,
    testFramework: (flags['test-framework'] ?? 'jest') as GeneratorOptions['testFramework'],
    fileNaming: (flags['file-naming'] ?? 'index') as GeneratorOptions['fileNaming'],
    exportStyle: (flags['export-style'] ?? 'named') as GeneratorOptions['exportStyle'],
  };

  const conventions = detectConventions(scanSiblingComponents(targetDir));

  const styleLibFlag = flags['style-lib'] as StyleLib | undefined;
  const styleLib = styleLibFlag && styleLibFlag !== ('auto' as string) ? styleLibFlag : detectStyleLibFromDeps(deps);

  const options: GeneratorOptions = {
    ...baseOptions,
    fileNaming: conventions.fileNaming ?? baseOptions.fileNaming,
    exportStyle: conventions.exportStyle ?? baseOptions.exportStyle,
    styleFormat: conventions.styleFormat ?? baseOptions.styleFormat,
    testFramework: conventions.testFramework ?? baseOptions.testFramework,
    styleLib,
    componentType,
    props: [],
    fields,
  };

  const template = templates[stack];
  fs.mkdirSync(componentFolder);

  const mainFile = template.mainFile(componentName, options);
  fs.writeFileSync(path.join(componentFolder, mainFile.fileName), mainFile.content, 'utf8');

  const markupFile = template.markupFile?.(componentName, options);
  if (markupFile) {
    fs.writeFileSync(path.join(componentFolder, markupFile.fileName), markupFile.content, 'utf8');
  }

  const styleFile = template.styleFile(componentName, options);
  if (styleFile) {
    fs.writeFileSync(path.join(componentFolder, styleFile.fileName), styleFile.content, 'utf8');
  }

  const testFile = template.testFile(componentName, options);
  if (testFile) {
    fs.writeFileSync(path.join(componentFolder, testFile.fileName), testFile.content, 'utf8');
  }

  const barrelPath = path.join(targetDir, 'index.ts');
  if (fs.existsSync(barrelPath)) {
    const existing = fs.readFileSync(barrelPath, 'utf8');
    const updated = addBarrelExport(existing, buildBarrelExportLine(stack, componentName, options));
    if (updated !== null) {
      fs.writeFileSync(barrelPath, updated, 'utf8');
    }
  }

  console.log(`Generated ${stackLabels[stack]} ${componentType} component "${componentName}" in ${componentFolder}`);
}

/* istanbul ignore next -- exercised via the compiled bin entry point, not unit tests */
if (require.main === module) {
  run(process.argv.slice(2));
}
