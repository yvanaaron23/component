// Pure so it's reusable from both the VS Code extension host and the standalone CLI.
// `exportLine` is pre-built by the caller (it varies by stack — see extension.ts /
// cli.ts), this just decides whether it needs adding and appends it cleanly.
export function addBarrelExport(existingContent: string, exportLine: string): string | null {
  if (existingContent.includes(exportLine)) {
    return null;
  }

  const trimmed = existingContent.length > 0 && !existingContent.endsWith('\n') ? `${existingContent}\n` : existingContent;
  return `${trimmed}${exportLine}\n`;
}
