/** Opaque text ids for database rows. */
import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}
