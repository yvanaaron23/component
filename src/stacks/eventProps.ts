import { PropSpec } from './types';

export interface EventSpec {
  eventName: string;
  paramType: string;
}

export interface SplitProps {
  dataProps: PropSpec[];
  events: EventSpec[];
}

// Shared by Vue and Angular: a callback prop named `onX` (React-style) maps to a
// framework-native event/output named `x`, instead of being passed as a raw function prop.
export function splitCallbackProps(props: PropSpec[]): SplitProps {
  const dataProps: PropSpec[] = [];
  const events: EventSpec[] = [];

  for (const prop of props) {
    const isCallback = /^on[A-Z]/.test(prop.name) && prop.type.includes('=>');
    if (!isCallback) {
      dataProps.push(prop);
      continue;
    }
    const eventName = prop.name.charAt(2).toLowerCase() + prop.name.slice(3);
    const paramMatch = prop.type.match(/^\(([^)]*)\)\s*=>/);
    const rawParam = paramMatch ? paramMatch[1].trim() : '';
    const paramType = rawParam ? rawParam.split(':').slice(1).join(':').trim() : '';
    events.push({ eventName, paramType });
  }

  return { dataProps, events };
}
