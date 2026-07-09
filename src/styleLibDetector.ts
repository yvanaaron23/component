import { StyleLib } from './stacks/types';

// Pure so it's reusable from both the VS Code extension host and the standalone CLI.
export function detectStyleLibFromDeps(deps: Record<string, string>): StyleLib {
  if (deps['tailwindcss']) {
    return 'tailwind';
  }
  if (deps['styled-components']) {
    return 'styled-components';
  }
  if (deps['@emotion/styled'] || deps['@emotion/react']) {
    return 'emotion';
  }
  if (deps['@chakra-ui/react']) {
    return 'chakra-ui';
  }
  if (deps['@mui/material']) {
    return 'mui';
  }
  return 'plain';
}
