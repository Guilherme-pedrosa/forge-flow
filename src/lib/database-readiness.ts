/** Only missing schema is an activation issue. Auth/network errors remain failures. */
export function isMissingDatabaseStructure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && ["42703", "42P01", "PGRST204", "PGRST205"].includes(code);
}
