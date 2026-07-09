import * as vscode from 'vscode';
import { FieldKind, FieldSpec, fieldKindLabels } from './stacks/fieldSpec';

type FieldPickItem =
  | { action: 'add'; label: string; alwaysShow: true }
  | { action: 'field'; label: string; description: string; field: FieldSpec }
  | { action: 'done'; label: string; alwaysShow: true };

export const ADD_LABEL = '$(add) Add field…';
export const DONE_LABEL = '$(check) Done';

function reservedNamesFor(componentType: 'form' | 'list'): Set<string> {
  return componentType === 'form' ? new Set(['onSubmit', 'handleSubmit']) : new Set(['items', 'item', 'index']);
}

async function promptForNewField(
  componentType: 'form' | 'list',
  existing: FieldSpec[],
): Promise<FieldSpec | undefined> {
  const reserved = reservedNamesFor(componentType);

  const name = await vscode.window.showInputBox({
    prompt: 'Field name',
    placeHolder: 'e.g. price',
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
        return 'Must be a valid identifier (letters, digits, _ or $, not starting with a digit)';
      }
      if (reserved.has(trimmed)) {
        return `"${trimmed}" is reserved for this component type`;
      }
      if (existing.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
        return 'A field with this name already exists';
      }
      return undefined;
    },
  });
  if (!name) {
    return undefined;
  }

  const kindPick = await vscode.window.showQuickPick(
    (Object.keys(fieldKindLabels) as FieldKind[]).map((fieldKind) => ({
      label: fieldKindLabels[fieldKind],
      fieldKind,
    })),
    { placeHolder: 'Field type' },
  );
  if (!kindPick) {
    return undefined;
  }

  return { name: name.trim(), kind: kindPick.fieldKind };
}

// Interactive "table": add fields one at a time, see them accumulate, remove one
// by selecting it, confirm with Done. Returns undefined if the user cancels
// (Escape) instead of confirming, so the caller can abort generation.
export async function collectFields(componentType: 'form' | 'list', typeLabel: string): Promise<FieldSpec[] | undefined> {
  return new Promise((resolve) => {
    const fields: FieldSpec[] = [];
    let resolved = false;
    // qp.hide() fires onDidHide the same way a user Escape does. Set this right
    // before any hide() call we trigger ourselves so that handler can tell the
    // difference and not treat it as a cancellation.
    let programmaticHide = false;

    const qp = vscode.window.createQuickPick<FieldPickItem>();
    qp.title = `${typeLabel} fields`;

    const render = () => {
      qp.placeholder =
        fields.length === 0
          ? 'No custom fields yet — add one, or select Done to use the default'
          : 'Select "Add field" to add another, a field to remove it, or Done to confirm';
      qp.items = [
        { action: 'add', label: ADD_LABEL, alwaysShow: true },
        ...fields.map((f) => ({
          action: 'field' as const,
          label: f.name,
          description: `${fieldKindLabels[f.kind]} — select to remove`,
          field: f,
        })),
        { action: 'done', label: DONE_LABEL, alwaysShow: true },
      ];
    };
    render();
    qp.show();

    qp.onDidAccept(async () => {
      const picked = qp.selectedItems[0] ?? qp.activeItems[0];
      if (!picked) {
        return;
      }

      if (picked.action === 'done') {
        resolved = true;
        programmaticHide = true;
        qp.hide();
        qp.dispose();
        resolve(fields);
        return;
      }

      if (picked.action === 'field') {
        const idx = fields.indexOf(picked.field);
        if (idx >= 0) {
          fields.splice(idx, 1);
        }
        render();
        return;
      }

      // action === 'add'
      programmaticHide = true;
      qp.hide();
      const added = await promptForNewField(componentType, fields);
      if (added) {
        fields.push(added);
      }
      render();
      qp.show();
    });

    qp.onDidHide(() => {
      if (programmaticHide) {
        programmaticHide = false;
        return;
      }
      if (!resolved) {
        resolved = true;
        qp.dispose();
        resolve(undefined);
      }
    });
  });
}
