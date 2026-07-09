import { Stack } from './types';

// Pure (no vscode import) so it's safe to use from the standalone CLI too, which
// runs in plain Node outside the extension host.
export function detectStackFromDeps(deps: Record<string, string>): Stack | undefined {
  if (deps['@angular/core']) {
    return 'angular';
  }
  if (deps['vue']) {
    return 'vue';
  }
  if (deps['svelte']) {
    return 'svelte';
  }
  if (deps['react']) {
    return 'react';
  }
  return undefined;
}
