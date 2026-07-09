import { effectiveProps, sampleValueForType } from './componentBlueprint';
import { FieldSpec, fieldInitialValue, fieldInputType, fieldTsType, labelFor } from './fieldSpec';
import { GeneratedFile, GeneratorOptions, PropSpec, StackTemplate, isScss } from './types';

function mainFileName(componentName: string, options: GeneratorOptions): string {
  return options.fileNaming === 'index' ? 'index.svelte' : `${componentName}.svelte`;
}

function propsInterfaceBlock(props: PropSpec[], includeChildren: boolean): string {
  const lines = props.map((p) => `    ${p.name}: ${p.type};`);
  if (includeChildren) {
    lines.push(`    children?: import('svelte').Snippet;`);
  }
  return `  interface Props {\n${lines.join('\n')}\n  }\n`;
}

function destructureLine(props: PropSpec[], includeChildren: boolean): string {
  const names = [...props.map((p) => p.name), ...(includeChildren ? ['children'] : [])];
  return `  let { ${names.join(', ')} }: Props = $props();\n`;
}

function styleBlock(options: GeneratorOptions, selector: string | null): string {
  if (options.styleFormat === 'none' || options.styleLib === 'tailwind') {
    return '';
  }
  const langAttr = isScss(options.styleFormat) ? ' lang="scss"' : '';
  const body = selector ? `${selector} {\n}\n` : '';
  return `\n<style${langAttr}>\n${body}</style>\n`;
}

function svelteStateDeclFor(field: FieldSpec): string {
  return `  let ${field.name} = $state<${fieldTsType(field.kind)}>(${fieldInitialValue(field.kind)});`;
}

function svelteInputFor(field: FieldSpec): string {
  const label = `  <label for="${field.name}">${labelFor(field.name)}</label>`;
  if (field.kind === 'textarea') {
    return `${label}\n  <textarea id="${field.name}" bind:value={${field.name}}></textarea>`;
  }
  if (field.kind === 'checkbox') {
    return `${label}\n  <input id="${field.name}" type="checkbox" bind:checked={${field.name}} />`;
  }
  return `${label}\n  <input id="${field.name}" type="${fieldInputType(field.kind)}" bind:value={${field.name}} />`;
}

interface Body {
  script: string;
  markup: string;
  styleSelector: string | null;
}

function buildBody(componentName: string, options: GeneratorOptions): Body {
  const props = effectiveProps(options.componentType, options.props, options.fields);
  const rootClass = options.styleLib === 'tailwind' ? 'flex flex-col gap-2' : 'root';

  switch (options.componentType) {
    case 'button':
      return {
        script: `${propsInterfaceBlock(props, false)}\n${destructureLine(props, false)}`,
        markup: `<button onclick={${props.find((p) => p.name.startsWith('on'))?.name ?? 'onClick'}}>{${props[0]?.name ?? 'label'}}</button>`,
        styleSelector: null,
      };
    case 'modal':
      return {
        script: `${propsInterfaceBlock(props, true)}\n${destructureLine(props, true)}`,
        markup: `{#if isOpen}\n  <div class="${componentName}-overlay" onclick={onClose}>\n    <div class="${componentName}-panel" onclick={(event) => event.stopPropagation()}>\n      <h2>{title}</h2>\n      {@render children?.()}\n    </div>\n  </div>\n{/if}`,
        styleSelector: null,
      };
    case 'form': {
      if (options.fields.length === 0) {
        return {
          script: `${propsInterfaceBlock(props, false)}\n${destructureLine(props, false)}  let email = $state('');\n\n  function handleSubmit(event: SubmitEvent): void {\n    event.preventDefault();\n    onSubmit(email);\n  }\n`,
          markup: `<form onsubmit={handleSubmit}>\n  <label for="email">Email</label>\n  <input id="email" type="email" bind:value={email} />\n  <button type="submit">Submit</button>\n</form>`,
          styleSelector: null,
        };
      }

      const fields = options.fields;
      const stateDecls = fields.map(svelteStateDeclFor).join('\n');
      const inputs = fields.map(svelteInputFor).join('\n');
      const payload = `{ ${fields.map((f) => f.name).join(', ')} }`;
      return {
        script: `${propsInterfaceBlock(props, false)}\n${destructureLine(props, false)}${stateDecls}\n\n  function handleSubmit(event: SubmitEvent): void {\n    event.preventDefault();\n    onSubmit(${payload});\n  }\n`,
        markup: `<form onsubmit={handleSubmit}>\n${inputs}\n  <button type="submit">Submit</button>\n</form>`,
        styleSelector: null,
      };
    }
    case 'list': {
      if (options.fields.length === 0) {
        return {
          script: `${propsInterfaceBlock(props, false)}\n${destructureLine(props, false)}`,
          markup: `<ul>\n  {#each items as item, index (index)}\n    <li>{item}</li>\n  {/each}\n</ul>`,
          styleSelector: null,
        };
      }
      const itemMarkup = options.fields.map((f) => `{item.${f.name}}`).join(' ');
      return {
        script: `${propsInterfaceBlock(props, false)}\n${destructureLine(props, false)}`,
        markup: `<ul>\n  {#each items as item, index (index)}\n    <li>${itemMarkup}</li>\n  {/each}\n</ul>`,
        styleSelector: null,
      };
    }
    case 'blank':
    default:
      return {
        script: `${propsInterfaceBlock(props, true)}\n${destructureLine(props, true)}`,
        markup: `<div class="${rootClass}">\n  {@render children?.()}\n</div>`,
        styleSelector: '.root',
      };
  }
}

export const svelteTemplate: StackTemplate = {
  mainFile(componentName, options): GeneratedFile {
    const body = buildBody(componentName, options);
    const content = `<script lang="ts">\n${body.script}</script>\n\n${body.markup}\n${styleBlock(options, body.styleSelector)}`;

    return { fileName: mainFileName(componentName, options), content };
  },

  styleFile(): GeneratedFile | null {
    // Svelte keeps styles embedded and auto-scoped in the component's <style> block.
    return null;
  },

  testFile(componentName, options): GeneratedFile | null {
    if (!options.generateTest) {
      return null;
    }
    const props = effectiveProps(options.componentType, options.props, options.fields);
    const importPath = options.fileNaming === 'index' ? './index.svelte' : `./${componentName}.svelte`;
    const testImports =
      options.testFramework === 'vitest'
        ? `import { describe, it, expect } from 'vitest';\nimport { render } from '@testing-library/svelte';`
        : `import { render } from '@testing-library/svelte';`;

    const propsArg =
      props.length > 0
        ? `, { props: { ${props.map((p) => `${p.name}: ${sampleValueForType(p.type)}`).join(', ')} } }`
        : '';

    return {
      fileName: `${componentName}.test.ts`,
      content: `${testImports}\nimport ${componentName} from '${importPath}';\n\ndescribe('${componentName}', () => {\n  it('renders without crashing', () => {\n    const { container } = render(${componentName}${propsArg});\n    expect(container).toBeTruthy();\n  });\n});\n`,
    };
  },
};
