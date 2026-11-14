const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a UUID string. Checked before any id from a URL reaches the database. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
