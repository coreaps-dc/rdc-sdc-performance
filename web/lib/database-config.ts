export function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL wajib diisi.');

  if (!URL.canParse(value)) throw new Error('DATABASE_URL tidak valid.');

  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname || parsed.pathname.length < 2) {
    throw new Error('DATABASE_URL harus menunjuk ke database PostgreSQL.');
  }

  return value;
}
