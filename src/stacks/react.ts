import { effectiveProps, sampleValueForType } from './componentBlueprint';
import { FieldSpec, fieldInitialValue, fieldInputType, fieldTsType, labelFor } from './fieldSpec';
import { ComponentType, GeneratedFile, GeneratorOptions, StackTemplate, StyleLib, toPascalCase } from './types';

// `modal` never uses the generic root wrapper (it builds its own overlay/panel divs),
// and a `button` rendered via Chakra/MUI is styled by the library's own <Button>.
function usesGenericRootStyle(componentType: ComponentType, styleLib: StyleLib): boolean {
  if (componentType === 'modal') {
    return false;
  }
  if (componentType === 'button') {
    return styleLib !== 'chakra-ui' && styleLib !== 'mui';
  }
  return true;
}

function mainFileName(componentName: string, options: GeneratorOptions): string {
  return options.fileNaming === 'index' ? 'index.tsx' : `${componentName}.tsx`;
}

function styleFileName(componentName: string, options: GeneratorOptions): string | null {
  if (options.styleLib !== 'plain') {
    return null;
  }
  switch (options.styleFormat) {
    case 'css-module':
      return `${componentName}.module.css`;
    case 'scss-module':
      return `${componentName}.module.scss`;
    case 'css':
      return `${componentName}.css`;
    case 'scss':
      return `${componentName}.scss`;
    case 'none':
      return null;
  }
}

interface StyleSetup {
  imports: string;
  styledDecl: string;
  rootOpen: string;
  rootClose: string;
}

function buildStyleSetup(componentName: string, options: GeneratorOptions): StyleSetup {
  switch (options.styleLib) {
    case 'tailwind':
      return { imports: '', styledDecl: '', rootOpen: '<div className="flex flex-col gap-2">', rootClose: '</div>' };
    case 'styled-components':
    case 'emotion': {
      const lib = options.styleLib === 'styled-components' ? 'styled-components' : '@emotion/styled';
      return {
        imports: `import styled from '${lib}';\n`,
        styledDecl: `const Root = styled.div\`\n  display: flex;\n  flex-direction: column;\n  gap: 0.5rem;\n\`;\n\n`,
        rootOpen: '<Root>',
        rootClose: '</Root>',
      };
    }
    case 'chakra-ui':
      return {
        imports: `import { Box } from '@chakra-ui/react';\n`,
        styledDecl: '',
        rootOpen: '<Box display="flex" flexDirection="column" gap={2}>',
        rootClose: '</Box>',
      };
    case 'mui':
      return {
        imports: `import { Box } from '@mui/material';\n`,
        styledDecl: '',
        rootOpen: `<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>`,
        rootClose: '</Box>',
      };
    case 'plain':
    default: {
      const isModule = options.styleFormat === 'css-module' || options.styleFormat === 'scss-module';
      const fileName = styleFileName(componentName, options);
      const imports = fileName ? (isModule ? `import styles from './${fileName}';\n` : `import './${fileName}';\n`) : '';
      const classAttr = isModule
        ? ' className={styles.root}'
        : options.styleFormat !== 'none'
          ? ` className="${componentName}"`
          : '';
      return { imports, styledDecl: '', rootOpen: `<div${classAttr}>`, rootClose: '</div>' };
    }
  }
}

interface Body {
  propsInterfaceBody: string;
  paramNames: string[];
  functionBody: string;
  extraImports: string;
}

function stateDeclFor(field: FieldSpec): string {
  return `  const [${field.name}, set${toPascalCase(field.name)}] = React.useState<${fieldTsType(field.kind)}>(${fieldInitialValue(field.kind)});`;
}

function inputFor(field: FieldSpec): string {
  const setter = `set${toPascalCase(field.name)}`;
  const label = `        <label htmlFor="${field.name}">${labelFor(field.name)}</label>`;
  if (field.kind === 'textarea') {
    return `${label}\n        <textarea id="${field.name}" value={${field.name}} onChange={(event) => ${setter}(event.target.value)} />`;
  }
  if (field.kind === 'checkbox') {
    return `${label}\n        <input id="${field.name}" type="checkbox" checked={${field.name}} onChange={(event) => ${setter}(event.target.checked)} />`;
  }
  if (field.kind === 'number') {
    return `${label}\n        <input id="${field.name}" type="number" value={${field.name}} onChange={(event) => ${setter}(event.target.valueAsNumber)} />`;
  }
  return `${label}\n        <input id="${field.name}" type="${fieldInputType(field.kind)}" value={${field.name}} onChange={(event) => ${setter}(event.target.value)} />`;
}

function buildBody(componentName: string, options: GeneratorOptions, style: StyleSetup): Body {
  const props = effectiveProps(options.componentType, options.props, options.fields);
  const propLines = (extra: string[] = []) => [...props.map((p) => `  ${p.name}: ${p.type};`), ...extra].join('\n');

  switch (options.componentType) {
    case 'button': {
      const isChakraOrMui = options.styleLib === 'chakra-ui' || options.styleLib === 'mui';
      const extraImports = isChakraOrMui
        ? `import { Button } from '${options.styleLib === 'chakra-ui' ? '@chakra-ui/react' : '@mui/material'}';\n`
        : '';
      const functionBody = isChakraOrMui
        ? '  return <Button onClick={onClick}>{label}</Button>;'
        : `  return (\n    ${style.rootOpen}\n      <button onClick={onClick}>{label}</button>\n    ${style.rootClose}\n  );`;
      return { propsInterfaceBody: propLines(), paramNames: props.map((p) => p.name), functionBody, extraImports };
    }
    case 'modal': {
      const functionBody = `  if (!isOpen) {\n    return null;\n  }\n\n  return (\n    <div className="${componentName}-overlay" onClick={onClose}>\n      <div className="${componentName}-panel" onClick={(event) => event.stopPropagation()}>\n        <h2>{title}</h2>\n        {children}\n      </div>\n    </div>\n  );`;
      return {
        propsInterfaceBody: propLines(['  children?: React.ReactNode;']),
        paramNames: [...props.map((p) => p.name), 'children'],
        functionBody,
        extraImports: '',
      };
    }
    case 'form': {
      if (options.fields.length === 0) {
        const functionBody = `  const [email, setEmail] = React.useState('');\n\n  function handleSubmit(event: React.FormEvent) {\n    event.preventDefault();\n    onSubmit(email);\n  }\n\n  return (\n    ${style.rootOpen}\n      <form onSubmit={handleSubmit}>\n        <label htmlFor="email">Email</label>\n        <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />\n        <button type="submit">Submit</button>\n      </form>\n    ${style.rootClose}\n  );`;
        return { propsInterfaceBody: propLines(), paramNames: props.map((p) => p.name), functionBody, extraImports: '' };
      }

      const fields = options.fields;
      const stateDecls = fields.map(stateDeclFor).join('\n');
      const inputs = fields.map(inputFor).join('\n');
      const payload = `{ ${fields.map((f) => f.name).join(', ')} }`;
      const functionBody = `${stateDecls}\n\n  function handleSubmit(event: React.FormEvent) {\n    event.preventDefault();\n    onSubmit(${payload});\n  }\n\n  return (\n    ${style.rootOpen}\n      <form onSubmit={handleSubmit}>\n${inputs}\n        <button type="submit">Submit</button>\n      </form>\n    ${style.rootClose}\n  );`;
      return { propsInterfaceBody: propLines(), paramNames: props.map((p) => p.name), functionBody, extraImports: '' };
    }
    case 'list': {
      if (options.fields.length === 0) {
        const functionBody = `  return (\n    ${style.rootOpen}\n      <ul>\n        {items.map((item, index) => (\n          <li key={index}>{item}</li>\n        ))}\n      </ul>\n    ${style.rootClose}\n  );`;
        return { propsInterfaceBody: propLines(), paramNames: props.map((p) => p.name), functionBody, extraImports: '' };
      }

      const itemMarkup = options.fields.map((f) => `{item.${f.name}}`).join(' ');
      const functionBody = `  return (\n    ${style.rootOpen}\n      <ul>\n        {items.map((item, index) => (\n          <li key={index}>${itemMarkup}</li>\n        ))}\n      </ul>\n    ${style.rootClose}\n  );`;
      return { propsInterfaceBody: propLines(), paramNames: props.map((p) => p.name), functionBody, extraImports: '' };
    }
    case 'blank':
    default: {
      const functionBody = `  return (\n    ${style.rootOpen}\n      {children}\n    ${style.rootClose}\n  );`;
      return {
        propsInterfaceBody: propLines(['  children?: React.ReactNode;']),
        paramNames: [...props.map((p) => p.name), 'children'],
        functionBody,
        extraImports: '',
      };
    }
  }
}

export const reactTemplate: StackTemplate = {
  mainFile(componentName, options): GeneratedFile {
    const style = buildStyleSetup(componentName, options);
    const body = buildBody(componentName, options, style);

    const propsInterface = `export interface ${componentName}Props {\n${body.propsInterfaceBody}\n}\n`;
    const componentDecl = `function ${componentName}({ ${body.paramNames.join(', ')} }: ${componentName}Props) {\n${body.functionBody}\n}\n`;
    const exportStatement =
      options.exportStyle === 'named' ? `export { ${componentName} };\n` : `export default ${componentName};\n`;

    const includeStyleSetup = usesGenericRootStyle(options.componentType, options.styleLib);
    const styleImports = includeStyleSetup ? style.imports : '';
    const styledDecl = includeStyleSetup ? style.styledDecl : '';

    const content = `import React from 'react';\n${styleImports}${body.extraImports}\n${styledDecl}${propsInterface}\n${componentDecl}\n${exportStatement}`;

    return { fileName: mainFileName(componentName, options), content };
  },

  styleFile(componentName, options): GeneratedFile | null {
    if (!usesGenericRootStyle(options.componentType, options.styleLib)) {
      return null;
    }
    const fileName = styleFileName(componentName, options);
    if (!fileName) {
      return null;
    }
    const isModule = options.styleFormat === 'css-module' || options.styleFormat === 'scss-module';
    const selector = isModule ? '.root' : `.${componentName}`;
    return { fileName, content: `${selector} {\n}\n` };
  },

  testFile(componentName, options): GeneratedFile | null {
    if (!options.generateTest) {
      return null;
    }
    const props = effectiveProps(options.componentType, options.props, options.fields);
    const importPath = options.fileNaming === 'index' ? './index' : `./${componentName}`;
    const importStatement =
      options.exportStyle === 'named'
        ? `import { ${componentName} } from '${importPath}';`
        : `import ${componentName} from '${importPath}';`;

    const testImports =
      options.testFramework === 'vitest'
        ? `import { describe, it, expect } from 'vitest';\nimport { render, screen } from '@testing-library/react';`
        : `import { render, screen } from '@testing-library/react';`;

    const propsAttrs = props.map((p) => `${p.name}={${sampleValueForType(p.type)}}`).join(' ');
    const jsx = propsAttrs ? `<${componentName} ${propsAttrs} />` : `<${componentName} />`;

    return {
      fileName: `${componentName}.test.tsx`,
      content: `${testImports}\n${importStatement}\n\ndescribe('${componentName}', () => {\n  it('renders without crashing', () => {\n    render(${jsx});\n  });\n});\n`,
    };
  },
};
