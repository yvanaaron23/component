import { effectiveProps, sampleValueForType } from './componentBlueprint';
import { splitCallbackProps } from './eventProps';
import { FieldSpec, fieldInitialValue, fieldInputType, fieldTsType, labelFor } from './fieldSpec';
import { GeneratedFile, GeneratorOptions, PropSpec, StackTemplate, isScss, toKebabCase } from './types';

// Angular's style guide always uses kebab-case filenames with a `.component.*`
// suffix — the `fileNaming` setting (index vs componentName) doesn't apply here.
function baseFileName(componentName: string): string {
  return toKebabCase(componentName);
}

function selectorName(componentName: string): string {
  return `app-${toKebabCase(componentName)}`;
}

function inputDecls(dataProps: PropSpec[]): string {
  return dataProps.map((p) => `  ${p.name} = input.required<${p.type}>();`).join('\n');
}

function outputDecls(events: { eventName: string; paramType: string }[]): string {
  return events.map((e) => `  ${e.eventName} = output<${e.paramType || 'void'}>();`).join('\n');
}

// Joins declaration blocks that may individually be empty (e.g. no data props),
// without leaving a stray blank line where an empty block would have gone.
function combineDecls(...blocks: string[]): string {
  return blocks.filter((b) => b.length > 0).join('\n');
}

function signalDeclFor(field: FieldSpec): string {
  return `  ${field.name} = signal<${fieldTsType(field.kind)}>(${fieldInitialValue(field.kind)});`;
}

function angularInputFor(field: FieldSpec): string {
  const label = `  <label for="${field.name}">${labelFor(field.name)}</label>`;
  if (field.kind === 'textarea') {
    return `${label}\n  <textarea id="${field.name}" [value]="${field.name}()" (input)="${field.name}.set($any($event.target).value)"></textarea>`;
  }
  if (field.kind === 'checkbox') {
    return `${label}\n  <input id="${field.name}" type="checkbox" [checked]="${field.name}()" (change)="${field.name}.set($any($event.target).checked)" />`;
  }
  if (field.kind === 'number') {
    return `${label}\n  <input id="${field.name}" type="number" [value]="${field.name}()" (input)="${field.name}.set($any($event.target).valueAsNumber)" />`;
  }
  return `${label}\n  <input id="${field.name}" type="${fieldInputType(field.kind)}" [value]="${field.name}()" (input)="${field.name}.set($any($event.target).value)" />`;
}

interface Body {
  classBody: string;
  html: string;
  extraCoreImports: string[];
}

function buildBody(componentName: string, options: GeneratorOptions): Body {
  const props = effectiveProps(options.componentType, options.props, options.fields);
  const { dataProps, events } = splitCallbackProps(props);

  switch (options.componentType) {
    case 'button': {
      const clickEvent = events[0]?.eventName ?? 'click';
      return {
        classBody: combineDecls(inputDecls(dataProps), outputDecls(events)),
        html: `<button (click)="${clickEvent}.emit()">{{ ${dataProps[0]?.name ?? 'label'}() }}</button>`,
        extraCoreImports: ['input', 'output'],
      };
    }
    case 'modal': {
      const closeEvent = events.find((e) => e.eventName === 'close')?.eventName ?? events[0]?.eventName ?? 'close';
      return {
        classBody: combineDecls(inputDecls(dataProps), outputDecls(events)),
        html: `@if (isOpen()) {\n  <div class="${toKebabCase(componentName)}-overlay" (click)="${closeEvent}.emit()">\n    <div class="${toKebabCase(componentName)}-panel" (click)="$event.stopPropagation()">\n      <h2>{{ title() }}</h2>\n      <ng-content></ng-content>\n    </div>\n  </div>\n}`,
        extraCoreImports: ['input', 'output'],
      };
    }
    case 'form': {
      const submitEvent = events[0]?.eventName ?? 'submit';
      const submitParamType = events[0]?.paramType || 'string';
      const outputLine =
        events.length > 0 ? outputDecls(events) : `  ${submitEvent} = output<${submitParamType}>();`;

      if (options.fields.length === 0) {
        const classBody = combineDecls(
          inputDecls(dataProps),
          outputLine,
          `  email = signal('');\n\n  handleSubmit(event: Event): void {\n    event.preventDefault();\n    this.${submitEvent}.emit(this.email());\n  }`,
        );
        return {
          classBody,
          html: `<form (submit)="handleSubmit($event)">\n  <label for="email">Email</label>\n  <input id="email" type="email" [value]="email()" (input)="email.set($any($event.target).value)" />\n  <button type="submit">Submit</button>\n</form>`,
          extraCoreImports: ['input', 'output', 'signal'],
        };
      }

      const fields = options.fields;
      const signalDecls = fields.map(signalDeclFor).join('\n');
      const payload = `{ ${fields.map((f) => `${f.name}: this.${f.name}()`).join(', ')} }`;
      const methodBlock = `${signalDecls}\n\n  handleSubmit(event: Event): void {\n    event.preventDefault();\n    this.${submitEvent}.emit(${payload});\n  }`;
      const classBody = combineDecls(inputDecls(dataProps), outputLine, methodBlock);
      const inputs = fields.map(angularInputFor).join('\n');
      return {
        classBody,
        html: `<form (submit)="handleSubmit($event)">\n${inputs}\n  <button type="submit">Submit</button>\n</form>`,
        extraCoreImports: ['input', 'output', 'signal'],
      };
    }
    case 'list': {
      if (options.fields.length === 0) {
        return {
          classBody: inputDecls(dataProps),
          html: `<ul>\n  @for (item of items(); track $index) {\n    <li>{{ item }}</li>\n  }\n</ul>`,
          extraCoreImports: ['input'],
        };
      }
      const itemMarkup = options.fields.map((f) => `{{ item.${f.name} }}`).join(' ');
      return {
        classBody: inputDecls(dataProps),
        html: `<ul>\n  @for (item of items(); track $index) {\n    <li>${itemMarkup}</li>\n  }\n</ul>`,
        extraCoreImports: ['input'],
      };
    }
    case 'blank':
    default:
      return {
        classBody: inputDecls(dataProps) || '',
        html: `<div class="root">\n  <ng-content></ng-content>\n</div>`,
        extraCoreImports: dataProps.length > 0 ? ['input'] : [],
      };
  }
}

function styleFileName(componentName: string, options: GeneratorOptions): string | null {
  if (options.styleFormat === 'none' || options.styleLib === 'tailwind') {
    return null;
  }
  return `${baseFileName(componentName)}.component.${isScss(options.styleFormat) ? 'scss' : 'css'}`;
}

export const angularTemplate: StackTemplate = {
  mainFile(componentName, options): GeneratedFile {
    const base = baseFileName(componentName);
    const body = buildBody(componentName, options);
    const coreImports = ['Component', ...body.extraCoreImports].filter((v, i, arr) => arr.indexOf(v) === i);
    const styleUrlLine = styleFileName(componentName, options)
      ? `\n  styleUrl: './${base}.component.${isScss(options.styleFormat) ? 'scss' : 'css'}',`
      : '';

    const content = `import { ${coreImports.join(', ')} } from '@angular/core';

@Component({
  selector: '${selectorName(componentName)}',
  standalone: true,
  imports: [],
  templateUrl: './${base}.component.html',${styleUrlLine}
})
export class ${componentName}Component {
${body.classBody}
}
`;

    return { fileName: `${base}.component.ts`, content };
  },

  markupFile(componentName, options): GeneratedFile {
    const body = buildBody(componentName, options);
    return { fileName: `${baseFileName(componentName)}.component.html`, content: `${body.html}\n` };
  },

  styleFile(componentName, options): GeneratedFile | null {
    const fileName = styleFileName(componentName, options);
    if (!fileName) {
      return null;
    }
    return { fileName, content: '' };
  },

  testFile(componentName, options): GeneratedFile | null {
    if (!options.generateTest) {
      return null;
    }
    const base = baseFileName(componentName);
    const props = effectiveProps(options.componentType, options.props, options.fields);
    const { dataProps } = splitCallbackProps(props);

    const testImports =
      options.testFramework === 'vitest' ? `import { describe, it, expect, beforeEach } from 'vitest';\n` : '';

    const setInputLines = dataProps
      .map((p) => `    fixture.componentRef.setInput('${p.name}', ${sampleValueForType(p.type)});`)
      .join('\n');

    return {
      fileName: `${base}.component.spec.ts`,
      content: `${testImports}import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ${componentName}Component } from './${base}.component';

describe('${componentName}Component', () => {
  let fixture: ComponentFixture<${componentName}Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [${componentName}Component],
    }).compileComponents();

    fixture = TestBed.createComponent(${componentName}Component);
${setInputLines}
    fixture.detectChanges();
  });

  it('renders without crashing', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
`,
    };
  },
};
