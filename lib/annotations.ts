import { Annotation } from '@/types';

/** Longest note kept, in characters. Enough for a few sentences. */
export const MAX_NOTE_LENGTH = 500;

/** What the user enters for a note. */
export interface AnnotationInput {
  /** When it happened: ISO timestamp or epoch ms. */
  time: string | number;
  text: string;
}

/** Oldest first; notes at the same time keep their order. */
export function sortAnnotations(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Adds the note, or replaces the one with the same id. */
export function upsertAnnotation(annotations: Annotation[], annotation: Annotation): Annotation[] {
  return sortAnnotations([...annotations.filter(a => a.id !== annotation.id), annotation]);
}

export function newAnnotationId(): string {
  // crypto.randomUUID is only available in secure contexts (https or localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `note-${crypto.randomUUID()}`;
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Value for an <input type="datetime-local">: local time, to the minute. */
export function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses an <input type="datetime-local"> value as local time. Null if it isn't one. */
export function fromDateTimeLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '0'] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}
