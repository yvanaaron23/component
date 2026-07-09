import { FieldSpec } from './fieldSpec';

export type StyleFormat = 'css-module' | 'scss-module' | 'css' | 'scss' | 'none';
export type StyleLib = 'plain' | 'tailwind' | 'styled-components' | 'emotion' | 'chakra-ui' | 'mui';
export type TestFramework = 'jest' | 'vitest';
export type FileNaming = 'index' | 'componentName';
export type ExportStyle = 'named' | 'default';
export type ComponentType = 'blank' | 'button' | 'modal' | 'form' | 'list';
export type Stack = 'react' | 'vue' | 'svelte' | 'angular';

export interface PropSpec {
  name: string;
  type: string;
}

export interface GeneratorOptions {
  styleFormat: StyleFormat;
  styleLib: StyleLib;
  generateTest: boolean;
  testFramework: TestFramework;
  fileNaming: FileNaming;
  exportStyle: ExportStyle;
  componentType: ComponentType;
  props: PropSpec[];
  /** Custom fields for 'form'/'list'; ignored by other component types. Empty means "use the default". */
  fields: FieldSpec[];
}

export interface GeneratedFile {
  fileName: string;
  content: string;
}

export interface StackTemplate {
  mainFile(componentName: string, options: GeneratorOptions): GeneratedFile;
  styleFile(componentName: string, options: GeneratorOptions): GeneratedFile | null;
  testFile(componentName: string, options: GeneratorOptions): GeneratedFile | null;
  /** Only stacks that split markup into its own file (Angular) implement this. */
  markupFile?(componentName: string, options: GeneratorOptions): GeneratedFile | null;
}

export function toPascalCase(input: string): string {
  const words = splitWords(input);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
}

export function toKebabCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('-');
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function splitWords(input: string): string[] {
  return input
    .replace(/[_\-\s]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function isScss(styleFormat: StyleFormat): boolean {
  return styleFormat === 'scss' || styleFormat === 'scss-module';
}
