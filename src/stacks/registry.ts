import { angularTemplate } from './angular';
import { reactTemplate } from './react';
import { svelteTemplate } from './svelte';
import { vueTemplate } from './vue';
import { Stack, StackTemplate } from './types';

// Pure (no vscode import) so it's shared by both the extension host and the CLI.
export const templates: Record<Stack, StackTemplate> = {
  react: reactTemplate,
  vue: vueTemplate,
  svelte: svelteTemplate,
  angular: angularTemplate,
};

export const stackLabels: Record<Stack, string> = {
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  angular: 'Angular',
};
