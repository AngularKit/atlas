import type { Source } from './model.js';

export const escapeMarkdown = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('|', '&#124;').replaceAll('`', '&#96;').replaceAll('*', '&#42;').replaceAll('_', '&#95;')
  .replaceAll('[', '&#91;').replaceAll(']', '&#93;').replace(/[\r\n]+/g, ' ');
export const sourceLabel = (value: Source): string => `${escapeMarkdown(value.file)}:${value.line}:${value.column}`;
