import * as vscode from 'vscode';
import { Stack } from './stacks/types';
import { detectStackFromDeps } from './stacks/stackFromDeps';

export { detectStackFromDeps } from './stacks/stackFromDeps';

async function findNearestPackageJson(startFolder: vscode.Uri): Promise<vscode.Uri | undefined> {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(startFolder)?.uri;
  let current = startFolder;

  for (let depth = 0; depth < 20; depth++) {
    const candidate = vscode.Uri.joinPath(current, 'package.json');
    try {
      await vscode.workspace.fs.stat(candidate);
      return candidate;
    } catch {
      // no package.json here, keep walking up
    }

    if (workspaceRoot && current.toString() === workspaceRoot.toString()) {
      return undefined;
    }

    const parent = vscode.Uri.joinPath(current, '..');
    if (parent.toString() === current.toString()) {
      return undefined;
    }
    current = parent;
  }

  return undefined;
}

export async function readNearestPackageJsonDeps(targetFolder: vscode.Uri): Promise<Record<string, string>> {
  const packageJsonUri = await findNearestPackageJson(targetFolder);
  if (!packageJsonUri) {
    return {};
  }

  try {
    const raw = await vscode.workspace.fs.readFile(packageJsonUri);
    const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

export async function detectStack(targetFolder: vscode.Uri): Promise<Stack | undefined> {
  const deps = await readNearestPackageJsonDeps(targetFolder);
  return detectStackFromDeps(deps);
}
