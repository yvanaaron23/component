import { FieldSpec, objectTypeLiteral } from './fieldSpec';
import { ComponentType, PropSpec } from './types';

export interface Blueprint {
  defaultProps: PropSpec[];
}

// Default props used when a component type is picked without generating from a
// code selection (see selectionParser.ts, which supplies its own `props` instead).
export const blueprints: Record<ComponentType, Blueprint> = {
  blank: { defaultProps: [] },
  button: {
    defaultProps: [
      { name: 'label', type: 'string' },
      { name: 'onClick', type: '() => void' },
    ],
  },
  modal: {
    defaultProps: [
      { name: 'isOpen', type: 'boolean' },
      { name: 'title', type: 'string' },
      { name: 'onClose', type: '() => void' },
    ],
  },
  form: {
    defaultProps: [{ name: 'onSubmit', type: '(email: string) => void' }],
  },
  list: {
    defaultProps: [{ name: 'items', type: 'string[]' }],
  },
};

export function effectiveProps(
  componentType: ComponentType,
  props: PropSpec[],
  fields: FieldSpec[] = [],
): PropSpec[] {
  if (props.length > 0) {
    return props;
  }
  if (componentType === 'form' && fields.length > 0) {
    return [{ name: 'onSubmit', type: `(values: ${objectTypeLiteral(fields)}) => void` }];
  }
  if (componentType === 'list' && fields.length > 0) {
    return [{ name: 'items', type: `${objectTypeLiteral(fields)}[]` }];
  }
  return blueprints[componentType].defaultProps;
}

export const componentTypeLabels: Record<ComponentType, string> = {
  blank: 'Blank (children/slot only)',
  button: 'Button',
  modal: 'Modal',
  form: 'Form',
  list: 'List',
};

/** A best-effort literal to satisfy a prop's type in generated test/sample code. */
export function sampleValueForType(type: string): string {
  const trimmed = type.trim();
  if (trimmed === 'string') {
    return `''`;
  }
  if (trimmed === 'number') {
    return '0';
  }
  if (trimmed === 'boolean') {
    return 'false';
  }
  if (trimmed.endsWith('[]')) {
    return '[]';
  }
  if (trimmed.includes('=>')) {
    return '() => {}';
  }
  return 'undefined';
}
