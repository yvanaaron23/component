import * as vscode from 'vscode';
import { addBarrelExport } from './barrelUpdater';
import { collectFields } from './fieldCollector';
import { componentTypeLabels } from './stacks/componentBlueprint';
import { detectStackFromDeps, readNearestPackageJsonDeps } from './stackDetector';
import { templates, stackLabels } from './stacks/registry';
import { FieldSpec } from './stacks/fieldSpec';
import { ComponentType, GeneratorOptions, PropSpec, Stack, StyleLib, toKebabCase, toPascalCase } from './stacks/types';
import { detectStyleLibFromDeps } from './styleLibDetector';
import { detectConventions, SiblingComponent } from './conventions';
import { inferPropsFromSelection } from './selectionParser';

function readBaseOptions(): Omit<GeneratorOptions, 'styleLib' | 'componentType' | 'props' | 'fields'> {
  const config = vscode.workspace.getConfiguration('componentGenerator');
  return {
    styleFormat: config.get('styleFormat', 'css-module'),
    generateTest: config.get('generateTest', true),
    testFramework: config.get('testFramework', 'jest'),
    fileNaming: config.get('fileNaming', 'index'),
    exportStyle: config.get('exportStyle', 'named'),
  };
}

function readForcedStack(): Stack | 'auto' {
  return vscode.workspace.getConfiguration('componentGenerator').get('stack', 'auto');
}

function readForcedStyleLib(): StyleLib | 'auto' {
  return vscode.workspace.getConfiguration('componentGenerator').get('styleLib', 'auto');
}

async function pickTargetFolder(clickedUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (clickedUri) {
    return clickedUri;
  }

  // Invoked from inside a code file (editor context menu / command palette while
  // editing) rather than a right-click on an Explorer folder: use that file's own
  // folder as the target instead of making the user browse for one.
  const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
  if (activeDocumentUri && activeDocumentUri.scheme === 'file') {
    return vscode.Uri.joinPath(activeDocumentUri, '..');
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const defaultUri = workspaceFolders?.[0]?.uri;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: 'Generate component here',
  });

  return picked?.[0];
}

async function resolveStack(targetFolder: vscode.Uri, deps: Record<string, string>): Promise<Stack | undefined> {
  const forced = readForcedStack();
  if (forced !== 'auto') {
    return forced;
  }

  const detected = detectStackFromDeps(deps);
  if (detected) {
    return detected;
  }

  const picked = await vscode.window.showQuickPick(
    (Object.keys(stackLabels) as Stack[]).map((stack) => ({ label: stackLabels[stack], stack })),
    { placeHolder: 'Could not detect a stack from package.json — pick one' },
  );

  return picked?.stack;
}

function resolveStyleLib(deps: Record<string, string>): StyleLib {
  const forced = readForcedStyleLib();
  if (forced !== 'auto') {
    return forced;
  }
  return detectStyleLibFromDeps(deps);
}

async function resolveComponentType(): Promise<ComponentType | undefined> {
  const picked = await vscode.window.showQuickPick(
    (Object.keys(componentTypeLabels) as ComponentType[]).map((type) => ({
      label: componentTypeLabels[type],
      type,
    })),
    { placeHolder: 'What kind of component?' },
  );
  return picked?.type;
}

async function folderExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function tryReadText(uri: vscode.Uri): Promise<string | null> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(raw).toString('utf8');
  } catch {
    return null;
  }
}

async function scanSiblingComponents(targetFolder: vscode.Uri): Promise<SiblingComponent[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(targetFolder);
  } catch {
    return [];
  }

  const folders = entries.filter(([, type]) => type === vscode.FileType.Directory).slice(0, 8);
  const siblings: SiblingComponent[] = [];

  for (const [folderName] of folders) {
    const folderUri = vscode.Uri.joinPath(targetFolder, folderName);
    let files: [string, vscode.FileType][];
    try {
      files = await vscode.workspace.fs.readDirectory(folderUri);
    } catch {
      continue;
    }

    const fileNames = files.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
    if (fileNames.length === 0) {
      continue;
    }

    const mainFileName = fileNames.find(
      (f) => !f.includes('.test.') && !f.includes('.spec.') && !/\.(css|scss|html)$/.test(f),
    );
    const testFileName = fileNames.find((f) => f.includes('.test.') || f.includes('.spec.'));

    const mainFileContent = mainFileName ? await tryReadText(vscode.Uri.joinPath(folderUri, mainFileName)) : null;
    const testFileContent = testFileName ? await tryReadText(vscode.Uri.joinPath(folderUri, testFileName)) : null;

    siblings.push({ folderName, fileNames, mainFileContent, testFileContent });
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

async function updateBarrelFile(targetFolder: vscode.Uri, stack: Stack, componentName: string, options: GeneratorOptions): Promise<void> {
  const barrelUri = vscode.Uri.joinPath(targetFolder, 'index.ts');
  const existingContent = await tryReadText(barrelUri);
  if (existingContent === null) {
    return; // no barrel file here — nothing to keep in sync
  }

  const exportLine = buildBarrelExportLine(stack, componentName, options);
  const updated = addBarrelExport(existingContent, exportLine);
  if (updated !== null) {
    await vscode.workspace.fs.writeFile(barrelUri, Buffer.from(updated, 'utf8'));
  }
}

interface GenerateParams {
  clickedUri?: vscode.Uri;
  forcedComponentType?: ComponentType;
  injectedProps?: PropSpec[];
  injectedFields?: FieldSpec[];
}

async function generateComponent({ clickedUri, forcedComponentType, injectedProps, injectedFields }: GenerateParams): Promise<void> {
  const targetFolder = await pickTargetFolder(clickedUri);
  if (!targetFolder) {
    return;
  }

  const deps = await readNearestPackageJsonDeps(targetFolder);
  const stack = await resolveStack(targetFolder, deps);
  if (!stack) {
    return;
  }

  const componentType = forcedComponentType ?? (await resolveComponentType());
  if (!componentType) {
    return;
  }

  let fields: FieldSpec[] = injectedFields ?? [];
  if (injectedFields === undefined && (componentType === 'form' || componentType === 'list')) {
    const collected = await collectFields(componentType, componentTypeLabels[componentType]);
    if (collected === undefined) {
      return;
    }
    fields = collected;
  }

  const rawName = await vscode.window.showInputBox({
    prompt: `Component name (${stackLabels[stack]} — ${componentTypeLabels[componentType]})`,
    placeHolder: 'MyComponent',
    validateInput: (value) => (value.trim().length === 0 ? 'Component name cannot be empty' : undefined),
  });

  if (!rawName) {
    return;
  }

  const componentName = toPascalCase(rawName);
  if (!componentName) {
    vscode.window.showErrorMessage('Could not derive a valid component name from your input.');
    return;
  }

  const componentFolder = vscode.Uri.joinPath(targetFolder, componentName);

  if (await folderExists(componentFolder)) {
    vscode.window.showErrorMessage(`A folder named "${componentName}" already exists here.`);
    return;
  }

  const baseOptions = readBaseOptions();
  const conventions = detectConventions(await scanSiblingComponents(targetFolder));

  const options: GeneratorOptions = {
    ...baseOptions,
    fileNaming: conventions.fileNaming ?? baseOptions.fileNaming,
    exportStyle: conventions.exportStyle ?? baseOptions.exportStyle,
    styleFormat: conventions.styleFormat ?? baseOptions.styleFormat,
    testFramework: conventions.testFramework ?? baseOptions.testFramework,
    styleLib: resolveStyleLib(deps),
    componentType,
    props: injectedProps ?? [],
    fields,
  };

  const template = templates[stack];

  await vscode.workspace.fs.createDirectory(componentFolder);

  const mainFile = template.mainFile(componentName, options);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(componentFolder, mainFile.fileName), Buffer.from(mainFile.content, 'utf8'));

  const markupFile = template.markupFile?.(componentName, options);
  if (markupFile) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(componentFolder, markupFile.fileName), Buffer.from(markupFile.content, 'utf8'));
  }

  const styleFile = template.styleFile(componentName, options);
  if (styleFile) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(componentFolder, styleFile.fileName), Buffer.from(styleFile.content, 'utf8'));
  }

  const testFile = template.testFile(componentName, options);
  if (testFile) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(componentFolder, testFile.fileName), Buffer.from(testFile.content, 'utf8'));
  }

  await updateBarrelFile(targetFolder, stack, componentName, options);

  const mainFileUri = vscode.Uri.joinPath(componentFolder, mainFile.fileName);
  const document = await vscode.workspace.openTextDocument(mainFileUri);
  await vscode.window.showTextDocument(document);

  vscode.window.showInformationMessage(
    `Generated ${stackLabels[stack]} ${componentTypeLabels[componentType].split(' ')[0].toLowerCase()} component "${componentName}".`,
  );
}

async function generateComponentFromSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showErrorMessage('Select some JSX/markup or a JSON sample first.');
    return;
  }

  const selectedText = editor.document.getText(editor.selection);
  const props = inferPropsFromSelection(selectedText);

  if (props.length === 0) {
    vscode.window.showWarningMessage('Could not infer any props from the selection — generating a blank component.');
  }

  await generateComponent({ forcedComponentType: 'blank', injectedProps: props });
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('component.generate', (uri?: vscode.Uri) => generateComponent({ clickedUri: uri })),
    vscode.commands.registerCommand('component.generateFromSelection', () => generateComponentFromSelection()),
  );
}

export function deactivate(): void {}
