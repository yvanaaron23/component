import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ADD_LABEL, DONE_LABEL } from '../fieldCollector';

async function withStub<T>(
  obj: Record<string, unknown>,
  method: string,
  stub: T,
  fn: () => Promise<void>,
): Promise<void> {
  const original = obj[method];
  obj[method] = stub;
  try {
    await fn();
  } finally {
    obj[method] = original;
  }
}

function makeProject(tmpRoot: string, name: string, deps: Record<string, string>): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, dependencies: deps }, null, 2));
  return dir;
}

// The extension shows a QuickPick for: how to generate (only when invoked from the
// editor with no folder clicked), the stack (only when it can't be auto-detected),
// and the component type (always). Route each call by its placeHolder text.
function stackAndTypeStub(preferredStack: string, preferredType: string, preferredMode?: 'in-place' | 'new-folder') {
  return async (items: unknown, options?: { placeHolder?: string }) => {
    const resolvedItems = (Array.isArray(items) ? items : await items) as Array<Record<string, string>>;
    if (options?.placeHolder?.includes('want to generate')) {
      return resolvedItems.find((item) => item.mode === preferredMode) ?? resolvedItems[0];
    }
    if (options?.placeHolder?.includes('kind of component')) {
      return resolvedItems.find((item) => item.type === preferredType) ?? resolvedItems[0];
    }
    return resolvedItems.find((item) => item.stack === preferredStack) ?? resolvedItems[0];
  };
}

// Same idea as stackAndTypeStub, but also routes the "Field type" QuickPick used
// by fieldCollector's promptForNewField — consumed in order, one per added field.
function typeAndFieldKindStub(preferredType: string, fieldKindQueue: string[] = []) {
  let fieldKindIndex = 0;
  return async (items: unknown, options?: { placeHolder?: string }) => {
    const resolvedItems = (Array.isArray(items) ? items : await items) as Array<Record<string, string>>;
    if (options?.placeHolder === 'Field type') {
      const wanted = fieldKindQueue[fieldKindIndex++];
      return resolvedItems.find((item) => item.fieldKind === wanted) ?? resolvedItems[0];
    }
    if (options?.placeHolder?.includes('kind of component')) {
      return resolvedItems.find((item) => item.type === preferredType) ?? resolvedItems[0];
    }
    return resolvedItems[0];
  };
}

// Routes showInputBox: the "Field name" prompt (inside fieldCollector, consumed in
// order for each added field) vs. the component name prompt.
function fieldAndNameInputStub(fieldNames: string[], componentName: string) {
  let fieldNameIndex = 0;
  return async (options?: { prompt?: string }) => {
    if (options?.prompt === 'Field name') {
      return fieldNames[fieldNameIndex++];
    }
    return componentName;
  };
}

interface FakeQuickPickItem {
  label: string;
  [key: string]: unknown;
}

// vscode.window.createQuickPick() returns a stateful object (not a Promise), so it
// needs its own fake distinct from the showQuickPick stubs above. `acceptByLabel`
// simulates selecting an item and fully awaits fieldCollector's async accept handler.
function fakeQuickPick<T extends FakeQuickPickItem>() {
  const acceptHandlers: Array<() => unknown> = [];
  const hideHandlers: Array<() => unknown> = [];
  const qp = {
    items: [] as T[],
    selectedItems: [] as T[],
    activeItems: [] as T[],
    title: undefined as string | undefined,
    placeholder: undefined as string | undefined,
    onDidAccept(cb: () => unknown) {
      acceptHandlers.push(cb);
      return { dispose() {} };
    },
    onDidHide(cb: () => unknown) {
      hideHandlers.push(cb);
      return { dispose() {} };
    },
    show() {},
    hide() {
      hideHandlers.forEach((cb) => cb());
    },
    dispose() {},
    async acceptByLabel(label: string): Promise<void> {
      const item = qp.items.find((i) => i.label === label);
      qp.selectedItems = item ? [item] : [];
      qp.activeItems = item ? [item] : [];
      for (const cb of acceptHandlers) {
        await cb();
      }
    },
  };
  return qp;
}

// Signals when collectFields actually calls createQuickPick (it happens after
// several prior `await`s in generateComponent), so tests can wait for that instead
// of racing a fixed number of interactive steps against unrelated async I/O.
function withCreateQuickPickSignal<T extends FakeQuickPickItem>(qp: ReturnType<typeof fakeQuickPick<T>>) {
  let resolveReady: () => void;
  const ready = new Promise<void>((res) => {
    resolveReady = res;
  });
  const stub = () => {
    resolveReady();
    return qp;
  };
  return { stub, ready };
}

suite('component.generate integration', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'component-generator-test-'));

  teardown(async () => {
    // The command opens the generated file in an editor tab, which holds a handle
    // on it on Windows until the tab is closed — close it so cleanup can proceed.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      // Best-effort cleanup of an OS temp dir; a lingering Windows file lock here
      // isn't a signal about the extension itself, so don't fail the suite over it.
      console.warn(`Could not fully clean up ${tmpRoot}:`, err);
    }
  });

  test('generates a React component when react is a dependency', async () => {
    const projectDir = makeProject(tmpRoot, 'react-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'my button', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'MyButton');
    assert.ok(fs.existsSync(path.join(componentDir, 'index.tsx')), 'index.tsx should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'MyButton.module.css')), 'style file should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'MyButton.test.tsx')), 'test file should exist');

    const mainContent = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(mainContent, /export \{ MyButton \};/);
    assert.match(mainContent, /className=\{styles\.root\}/);
  });

  test('generates a Vue component when vue is a dependency', async () => {
    const projectDir = makeProject(tmpRoot, 'vue-project', { vue: '^3.4.0' });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('vue', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'my button', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'MyButton');
    assert.ok(fs.existsSync(path.join(componentDir, 'index.vue')), 'index.vue should exist');
    assert.ok(!fs.existsSync(path.join(componentDir, 'MyButton.module.css')), 'no separate style file for vue');
    assert.ok(fs.existsSync(path.join(componentDir, 'MyButton.spec.ts')), 'spec file should exist');

    const mainContent = fs.readFileSync(path.join(componentDir, 'index.vue'), 'utf8');
    assert.match(mainContent, /<script setup lang="ts">/);
    assert.match(mainContent, /<style scoped>/);
  });

  test('generates a Svelte component when svelte is a dependency', async () => {
    const projectDir = makeProject(tmpRoot, 'svelte-project', { svelte: '^5.0.0' });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('svelte', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'my button', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'MyButton');
    assert.ok(fs.existsSync(path.join(componentDir, 'index.svelte')), 'index.svelte should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'MyButton.test.ts')), 'test file should exist');

    const mainContent = fs.readFileSync(path.join(componentDir, 'index.svelte'), 'utf8');
    assert.match(mainContent, /let \{ children \}: Props = \$props\(\);/);
  });

  test('generates an Angular component when @angular/core is a dependency', async () => {
    const projectDir = makeProject(tmpRoot, 'angular-project', { '@angular/core': '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('angular', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'my widget', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'MyWidget');
    assert.ok(fs.existsSync(path.join(componentDir, 'my-widget.component.ts')), 'kebab-case .component.ts should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'my-widget.component.html')), 'template file should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'my-widget.component.css')), 'style file should exist');
    assert.ok(fs.existsSync(path.join(componentDir, 'my-widget.component.spec.ts')), 'spec file should exist');

    const mainContent = fs.readFileSync(path.join(componentDir, 'my-widget.component.ts'), 'utf8');
    assert.match(mainContent, /selector: 'app-my-widget'/);
    assert.match(mainContent, /export class MyWidgetComponent/);
  });

  test('generates a button using the style library detected from package.json', async () => {
    const projectDir = makeProject(tmpRoot, 'chakra-project', { react: '^18.0.0', '@chakra-ui/react': '^2.8.0' });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'button'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'action button', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'ActionButton');
    const mainContent = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(mainContent, /from '@chakra-ui\/react'/);
    assert.ok(
      !fs.existsSync(path.join(componentDir, 'ActionButton.module.css')),
      'a Chakra button should not need its own css module',
    );
  });

  test('falls back to a manual QuickPick when no package.json is found', async () => {
    const projectDir = path.join(tmpRoot, 'no-package-json-project');
    fs.mkdirSync(projectDir, { recursive: true });
    const targetUri = vscode.Uri.file(projectDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('svelte', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'card', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(projectDir, 'Card');
    assert.ok(
      fs.existsSync(path.join(componentDir, 'index.svelte')),
      'should have used the manually picked svelte stack',
    );
  });

  test('blocks generation when the component folder already exists', async () => {
    const projectDir = makeProject(tmpRoot, 'collision-project', { react: '^18.0.0' });
    fs.mkdirSync(path.join(projectDir, 'Existing'));
    const targetUri = vscode.Uri.file(projectDir);

    let inputBoxCalled = false;
    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'blank'), async () => {
      await withStub(
        vscode.window,
        'showInputBox',
        async () => {
          inputBoxCalled = true;
          return 'existing';
        },
        async () => {
          await vscode.commands.executeCommand('component.generate', targetUri);
        },
      );
    });

    assert.ok(inputBoxCalled, 'input box should have been shown');
    const files = fs.readdirSync(path.join(projectDir, 'Existing'));
    assert.strictEqual(files.length, 0, 'no files should have been written into the colliding folder');
  });

  test('picks up sibling conventions and updates an existing barrel file', async () => {
    const projectDir = makeProject(tmpRoot, 'convention-project', { react: '^18.0.0' });
    const componentsDir = path.join(projectDir, 'src', 'components');
    fs.mkdirSync(path.join(componentsDir, 'Existing'), { recursive: true });
    fs.writeFileSync(
      path.join(componentsDir, 'Existing', 'Existing.tsx'),
      'export default function Existing() { return null; }\n',
    );
    fs.writeFileSync(path.join(componentsDir, 'index.ts'), "export { default as Existing } from './Existing/Existing';\n");

    const targetUri = vscode.Uri.file(componentsDir);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'blank'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'new one', async () => {
        await vscode.commands.executeCommand('component.generate', targetUri);
      });
    });

    const componentDir = path.join(componentsDir, 'NewOne');
    assert.ok(
      fs.existsSync(path.join(componentDir, 'NewOne.tsx')),
      'should follow the componentName file naming convention found in Existing/',
    );
    const mainContent = fs.readFileSync(path.join(componentDir, 'NewOne.tsx'), 'utf8');
    assert.match(mainContent, /export default NewOne;/);

    const barrelContent = fs.readFileSync(path.join(componentsDir, 'index.ts'), 'utf8');
    assert.match(barrelContent, /export \{ default as NewOne \} from '\.\/NewOne\/NewOne';/);
  });

  test('fills the active editor in place when invoked without a clicked folder', async () => {
    const projectDir = makeProject(tmpRoot, 'in-place-project', { react: '^18.0.0' });
    const subDir = path.join(projectDir, 'src', 'components');
    fs.mkdirSync(subDir, { recursive: true });
    const openFilePath = path.join(subDir, 'Sidebar.tsx');
    fs.writeFileSync(openFilePath, '');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(openFilePath));
    const editor = await vscode.window.showTextDocument(doc);

    // No showInputBox stub at all: the component name comes from the open file's
    // own name, not a prompt. If the command asked for a name, the (unstubbed)
    // showInputBox call would hang/fail rather than silently succeed.
    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'blank', 'in-place'), async () => {
      await vscode.commands.executeCommand('component.generate');
    });

    assert.ok(!fs.existsSync(path.join(subDir, 'Sidebar')), 'no new subfolder should have been created');
    assert.match(editor.document.getText(), /function Sidebar\(/, 'the open file itself should contain the component');
    assert.ok(
      fs.existsSync(path.join(subDir, 'Sidebar.module.css')),
      'the style file should be written next to the open file, not in a subfolder',
    );
    assert.ok(fs.existsSync(path.join(subDir, 'Sidebar.test.tsx')), 'the test file should be written alongside it too');
  });

  test('creates a new component folder next to the open file when that mode is picked', async () => {
    const projectDir = makeProject(tmpRoot, 'new-folder-from-editor-project', { react: '^18.0.0' });
    const subDir = path.join(projectDir, 'src', 'components');
    fs.mkdirSync(subDir, { recursive: true });
    const openFilePath = path.join(subDir, 'Sidebar.tsx');
    fs.writeFileSync(openFilePath, 'export {};\n');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(openFilePath));
    await vscode.window.showTextDocument(doc);

    await withStub(vscode.window, 'showQuickPick', stackAndTypeStub('react', 'blank', 'new-folder'), async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'widget', async () => {
        await vscode.commands.executeCommand('component.generate');
      });
    });

    assert.match(
      doc.getText(),
      /^export \{\};$/m,
      'the open file itself should be untouched',
    );
    const componentDir = path.join(subDir, 'Widget');
    assert.ok(
      fs.existsSync(path.join(componentDir, 'index.tsx')),
      'a new component folder should have been created next to the open file',
    );
  });

  test('generates from an editor selection with inferred props', async () => {
    const projectDir = makeProject(tmpRoot, 'selection-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);

    const doc = await vscode.workspace.openTextDocument({
      content: '<div>{title} {count}</div>',
      language: 'plaintext',
    });
    const editor = await vscode.window.showTextDocument(doc);
    const lastLine = doc.lineAt(doc.lineCount - 1);
    editor.selection = new vscode.Selection(0, 0, lastLine.lineNumber, lastLine.text.length);

    await withStub(vscode.window, 'showOpenDialog', async () => [targetUri], async () => {
      await withStub(vscode.window, 'showInputBox', async () => 'inferred', async () => {
        await vscode.commands.executeCommand('component.generateFromSelection');
      });
    });

    const componentDir = path.join(projectDir, 'Inferred');
    assert.ok(fs.existsSync(path.join(componentDir, 'index.tsx')), 'component should have been generated');
    const content = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(content, /title: string;/);
    assert.match(content, /count: string;/);
  });

  test('generates a multi-field form via the interactive field collector', async () => {
    const projectDir = makeProject(tmpRoot, 'multi-field-form-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);
    const qp = fakeQuickPick();
    const { stub, ready } = withCreateQuickPickSignal(qp);

    await withStub(vscode.window, 'createQuickPick', stub, async () => {
      await withStub(vscode.window, 'showQuickPick', typeAndFieldKindStub('form', ['text', 'textarea']), async () => {
        await withStub(vscode.window, 'showInputBox', fieldAndNameInputStub(['name', 'bio'], 'signup form'), async () => {
          const generatePromise = vscode.commands.executeCommand('component.generate', targetUri);
          await ready;
          await qp.acceptByLabel(ADD_LABEL);
          await qp.acceptByLabel(ADD_LABEL);
          await qp.acceptByLabel(DONE_LABEL);
          await generatePromise;
        });
      });
    });

    const componentDir = path.join(projectDir, 'SignupForm');
    const content = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(content, /onSubmit: \(values: \{ name: string; bio: string \}\) => void/);
    assert.match(content, /<textarea id="bio"/);
    assert.match(content, /onSubmit\(\{ name, bio \}\);/);
  });

  test('generates a multi-field list via the interactive field collector', async () => {
    const projectDir = makeProject(tmpRoot, 'multi-field-list-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);
    const qp = fakeQuickPick();
    const { stub, ready } = withCreateQuickPickSignal(qp);

    await withStub(vscode.window, 'createQuickPick', stub, async () => {
      await withStub(vscode.window, 'showQuickPick', typeAndFieldKindStub('list', ['text', 'number']), async () => {
        await withStub(vscode.window, 'showInputBox', fieldAndNameInputStub(['title', 'price'], 'price list'), async () => {
          const generatePromise = vscode.commands.executeCommand('component.generate', targetUri);
          await ready;
          await qp.acceptByLabel(ADD_LABEL);
          await qp.acceptByLabel(ADD_LABEL);
          await qp.acceptByLabel(DONE_LABEL);
          await generatePromise;
        });
      });
    });

    const componentDir = path.join(projectDir, 'PriceList');
    const content = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(content, /items: \{ title: string; price: number \}\[\]/);
    assert.match(content, /\{item\.title\} \{item\.price\}/);
  });

  test('clicking Done with zero fields matches the legacy hardcoded form', async () => {
    const projectDir = makeProject(tmpRoot, 'zero-field-form-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);
    const qp = fakeQuickPick();
    const { stub, ready } = withCreateQuickPickSignal(qp);

    await withStub(vscode.window, 'createQuickPick', stub, async () => {
      await withStub(vscode.window, 'showQuickPick', typeAndFieldKindStub('form'), async () => {
        await withStub(vscode.window, 'showInputBox', async () => 'legacy form', async () => {
          const generatePromise = vscode.commands.executeCommand('component.generate', targetUri);
          await ready;
          await qp.acceptByLabel(DONE_LABEL);
          await generatePromise;
        });
      });
    });

    const componentDir = path.join(projectDir, 'LegacyForm');
    const content = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
    assert.match(content, /onSubmit: \(email: string\) => void/);
    assert.match(content, /<input id="email" type="email"/);
  });

  test('cancels generation when the field picker is dismissed', async () => {
    const projectDir = makeProject(tmpRoot, 'cancel-fields-project', { react: '^18.0.0' });
    const targetUri = vscode.Uri.file(projectDir);
    const qp = fakeQuickPick();
    const { stub, ready } = withCreateQuickPickSignal(qp);

    await withStub(vscode.window, 'createQuickPick', stub, async () => {
      await withStub(vscode.window, 'showQuickPick', typeAndFieldKindStub('form'), async () => {
        const generatePromise = vscode.commands.executeCommand('component.generate', targetUri);
        await ready;
        qp.hide(); // simulate the user pressing Escape
        await generatePromise;
      });
    });

    const files = fs.readdirSync(projectDir);
    assert.deepStrictEqual(files, ['package.json'], 'no component folder should have been created');
  });
});
