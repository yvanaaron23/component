import { ExportStyle, FileNaming, StyleFormat, TestFramework } from './stacks/types';

export interface SiblingComponent {
  folderName: string;
  fileNames: string[];
  mainFileContent: string | null;
  testFileContent: string | null;
}

export interface DetectedConventions {
  fileNaming?: FileNaming;
  exportStyle?: ExportStyle;
  styleFormat?: StyleFormat;
  testFramework?: TestFramework;
}

// Pure so it's reusable from both the VS Code extension host and the standalone CLI.
// Looks at components already generated next to the new one and infers the
// conventions actually in use there, instead of only trusting global settings.
export function detectConventions(siblings: SiblingComponent[]): DetectedConventions {
  const result: DetectedConventions = {};
  if (siblings.length === 0) {
    return result;
  }

  const fileNamingVotes = { index: 0, componentName: 0 };
  const exportStyleVotes = { named: 0, default: 0 };
  const styleFormatVotes: Record<StyleFormat, number> = {
    'css-module': 0,
    'scss-module': 0,
    css: 0,
    scss: 0,
    none: 0,
  };
  const testFrameworkVotes = { jest: 0, vitest: 0 };

  for (const sibling of siblings) {
    if (sibling.fileNames.some((f) => /^index\.\w+$/.test(f))) {
      fileNamingVotes.index += 1;
    } else if (sibling.fileNames.some((f) => f.startsWith(sibling.folderName + '.'))) {
      fileNamingVotes.componentName += 1;
    }

    if (sibling.mainFileContent) {
      if (/export default /.test(sibling.mainFileContent)) {
        exportStyleVotes.default += 1;
      } else if (/export \{/.test(sibling.mainFileContent)) {
        exportStyleVotes.named += 1;
      }
    }

    if (sibling.fileNames.some((f) => /\.module\.css$/.test(f))) {
      styleFormatVotes['css-module'] += 1;
    } else if (sibling.fileNames.some((f) => /\.module\.scss$/.test(f))) {
      styleFormatVotes['scss-module'] += 1;
    } else if (sibling.fileNames.some((f) => /(?<!module)\.scss$/.test(f))) {
      styleFormatVotes.scss += 1;
    } else if (sibling.fileNames.some((f) => /(?<!module)\.css$/.test(f))) {
      styleFormatVotes.css += 1;
    }

    if (sibling.testFileContent) {
      if (/from ['"]vitest['"]/.test(sibling.testFileContent)) {
        testFrameworkVotes.vitest += 1;
      } else {
        testFrameworkVotes.jest += 1;
      }
    }
  }

  result.fileNaming = pickWinner(fileNamingVotes);
  result.exportStyle = pickWinner(exportStyleVotes);
  const styleFormatWinner = pickWinner(styleFormatVotes);
  if (styleFormatWinner) {
    result.styleFormat = styleFormatWinner;
  }
  result.testFramework = pickWinner(testFrameworkVotes);

  return result;
}

function pickWinner<T extends string>(votes: Record<T, number>): T | undefined {
  let winner: T | undefined;
  let max = 0;
  for (const key of Object.keys(votes) as T[]) {
    if (votes[key] > max) {
      max = votes[key];
      winner = key;
    }
  }
  return winner;
}
