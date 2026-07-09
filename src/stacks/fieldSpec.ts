export type FieldKind = 'text' | 'email' | 'password' | 'number' | 'textarea' | 'checkbox' | 'date';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
}

export const fieldKindLabels: Record<FieldKind, string> = {
  text: 'Text',
  email: 'Email',
  password: 'Password',
  number: 'Number',
  textarea: 'Textarea (multi-line text)',
  checkbox: 'Checkbox (boolean)',
  date: 'Date',
};

// Drives the generated TS type (props interface, state var, signal<T>, etc).
export function fieldTsType(kind: FieldKind): string {
  if (kind === 'number') {
    return 'number';
  }
  if (kind === 'checkbox') {
    return 'boolean';
  }
  return 'string'; // text, email, password, textarea, date
}

// Drives the concrete <input type="..."> attribute. 'textarea' is not a real
// input type — every stack template special-cases it into a <textarea> tag.
export function fieldInputType(kind: FieldKind): string {
  return kind;
}

// Initial/sample literal for local state (React useState / Vue ref / Svelte $state / Angular signal).
export function fieldInitialValue(kind: FieldKind): string {
  if (kind === 'number') {
    return '0';
  }
  if (kind === 'checkbox') {
    return 'false';
  }
  return `''`;
}

// Shared inline object-type literal used for both the form's onSubmit payload
// and the list's item type, e.g. "{ name: string; email: string }".
export function objectTypeLiteral(fields: FieldSpec[]): string {
  return `{ ${fields.map((f) => `${f.name}: ${fieldTsType(f.kind)}`).join('; ')} }`;
}

function labelFor(fieldName: string): string {
  return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

export { labelFor };
