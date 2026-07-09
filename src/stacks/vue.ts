import { effectiveProps, sampleValueForType } from './componentBlueprint';
import { EventSpec, splitCallbackProps } from './eventProps';
import { FieldSpec, fieldInitialValue, fieldInputType, fieldTsType, labelFor } from './fieldSpec';
import { GeneratedFile, GeneratorOptions, PropSpec, StackTemplate, isScss } from './types';

function mainFileName(componentName: string, options: GeneratorOptions): string {
  return options.fileNaming === 'index' ? 'index.vue' : `${componentName}.vue`;
}

function propsInterfaceBlock(dataProps: PropSpec[]): string {
  if (dataProps.length === 0) {
    return '';
  }
  const lines = dataProps.map((p) => `  ${p.name}: ${p.type};`).join('\n');
  return `interface Props {\n${lines}\n}\n\n`;
}

function definePropsLine(dataProps: PropSpec[]): string {
  if (dataProps.length === 0) {
    return '';
  }
  const names = dataProps.map((p) => p.name).join(', ');
  return `const { ${names} } = defineProps<Props>();\n`;
}

function defineEmitsBlock(events: EventSpec[]): string {
  if (events.length === 0) {
    return '';
  }
  const lines = events.map((e) => `  ${e.eventName}: [${e.paramType ? `payload: ${e.paramType}` : ''}];`).join('\n');
  return `const emit = defineEmits<{\n${lines}\n}>();\n`;
}

function styleBlock(options: GeneratorOptions, selector: string | null): string {
  if (options.styleFormat === 'none' || options.styleLib === 'tailwind') {
    return '';
  }
  const langAttr = isScss(options.styleFormat) ? ' lang="scss"' : '';
  const body = selector ? `${selector} {\n}\n` : '';
  return `\n<style scoped${langAttr}>\n${body}</style>\n`;
}

function refDeclFor(field: FieldSpec): string {
  return `const ${field.name} = ref<${fieldTsType(field.kind)}>(${fieldInitialValue(field.kind)});`;
}

function vueInputFor(field: FieldSpec): string {
  const label = `    <label for="${field.name}">${labelFor(field.name)}</label>`;
  if (field.kind === 'textarea') {
    return `${label}\n    <textarea id="${field.name}" v-model="${field.name}"></textarea>`;
  }
  if (field.kind === 'number') {
    return `${label}\n    <input id="${field.name}" type="number" v-model.number="${field.name}" />`;
  }
  return `${label}\n    <input id="${field.name}" type="${fieldInputType(field.kind)}" v-model="${field.name}" />`;
}

interface Body {
  script: string;
  template: string;
  styleSelector: string | null;
}

function buildBody(componentName: string, options: GeneratorOptions): Body {
  const props = effectiveProps(options.componentType, options.props, options.fields);
  const { dataProps, events } = splitCallbackProps(props);
  const propsBlock = propsInterfaceBlock(dataProps);
  const propsLine = definePropsLine(dataProps);
  const emitsLine = defineEmitsBlock(events);
  const rootClass = options.styleLib === 'tailwind' ? ' class="flex flex-col gap-2"' : ' class="root"';

  switch (options.componentType) {
    case 'button': {
      const clickEvent = events[0]?.eventName ?? 'click';
      return {
        script: `${propsBlock}${propsLine}${emitsLine}`,
        template: `<button @click="emit('${clickEvent}')">{{ ${dataProps[0]?.name ?? 'label'} }}</button>`,
        styleSelector: null,
      };
    }
    case 'modal': {
      const closeEvent = events.find((e) => e.eventName === 'close')?.eventName ?? events[0]?.eventName ?? 'close';
      return {
        script: `${propsBlock}${propsLine}${emitsLine}`,
        template: `<div v-if="isOpen" class="${componentName}-overlay" @click="emit('${closeEvent}')">\n    <div class="${componentName}-panel" @click.stop>\n      <h2>{{ title }}</h2>\n      <slot />\n    </div>\n  </div>`,
        styleSelector: null,
      };
    }
    case 'form': {
      const submitEvent = events[0]?.eventName ?? 'submit';
      const submitParamType = events[0]?.paramType || 'string';
      const forcedEmits =
        events.length > 0
          ? emitsLine
          : `const emit = defineEmits<{\n  ${submitEvent}: [payload: ${submitParamType}];\n}>();\n`;

      if (options.fields.length === 0) {
        const script = `${propsBlock}import { ref } from 'vue';\n\n${propsLine}${forcedEmits}const email = ref('');\n\nfunction handleSubmit(): void {\n  emit('${submitEvent}', email.value);\n}\n`;
        return {
          script,
          template: `<form @submit.prevent="handleSubmit">\n    <label for="email">Email</label>\n    <input id="email" type="email" v-model="email" />\n    <button type="submit">Submit</button>\n  </form>`,
          styleSelector: null,
        };
      }

      const fields = options.fields;
      const refDecls = fields.map(refDeclFor).join('\n');
      const inputs = fields.map(vueInputFor).join('\n');
      // Refs don't auto-unwrap inside plain script code (only in the template),
      // so the payload must read `.value` explicitly for each field.
      const payload = `{ ${fields.map((f) => `${f.name}: ${f.name}.value`).join(', ')} }`;
      const script = `${propsBlock}import { ref } from 'vue';\n\n${propsLine}${forcedEmits}${refDecls}\n\nfunction handleSubmit(): void {\n  emit('${submitEvent}', ${payload});\n}\n`;
      return {
        script,
        template: `<form @submit.prevent="handleSubmit">\n${inputs}\n    <button type="submit">Submit</button>\n  </form>`,
        styleSelector: null,
      };
    }
    case 'list': {
      if (options.fields.length === 0) {
        return {
          script: `${propsBlock}${propsLine}`,
          template: `<ul>\n    <li v-for="(item, index) in items" :key="index">{{ item }}</li>\n  </ul>`,
          styleSelector: null,
        };
      }
      const itemMarkup = options.fields.map((f) => `{{ item.${f.name} }}`).join(' ');
      return {
        script: `${propsBlock}${propsLine}`,
        template: `<ul>\n    <li v-for="(item, index) in items" :key="index">${itemMarkup}</li>\n  </ul>`,
        styleSelector: null,
      };
    }
    case 'blank':
    default: {
      return {
        script: `${propsBlock}${propsLine}${emitsLine}`,
        template: `<div${rootClass}>\n    <slot />\n  </div>`,
        styleSelector: '.root',
      };
    }
  }
}

export const vueTemplate: StackTemplate = {
  mainFile(componentName, options): GeneratedFile {
    const body = buildBody(componentName, options);
    const scriptSection = body.script.trim().length > 0 ? `<script setup lang="ts">\n${body.script}</script>` : `<script setup lang="ts">\n</script>`;

    const content = `${scriptSection}\n\n<template>\n  ${body.template}\n</template>\n${styleBlock(options, body.styleSelector)}`;

    return { fileName: mainFileName(componentName, options), content };
  },

  styleFile(): GeneratedFile | null {
    // Vue keeps styles embedded in the SFC's <style> block.
    return null;
  },

  testFile(componentName, options): GeneratedFile | null {
    if (!options.generateTest) {
      return null;
    }
    const props = effectiveProps(options.componentType, options.props, options.fields);
    const { dataProps } = splitCallbackProps(props);

    const importPath = options.fileNaming === 'index' ? './index.vue' : `./${componentName}.vue`;
    const testImports =
      options.testFramework === 'vitest'
        ? `import { describe, it, expect } from 'vitest';\nimport { mount } from '@vue/test-utils';`
        : `import { mount } from '@vue/test-utils';`;

    const propsArg =
      dataProps.length > 0
        ? `, { props: { ${dataProps.map((p) => `${p.name}: ${sampleValueForType(p.type)}`).join(', ')} } }`
        : '';

    return {
      fileName: `${componentName}.spec.ts`,
      content: `${testImports}\nimport ${componentName} from '${importPath}';\n\ndescribe('${componentName}', () => {\n  it('renders without crashing', () => {\n    const wrapper = mount(${componentName}${propsArg});\n    expect(wrapper.exists()).toBe(true);\n  });\n});\n`,
    };
  },
};
