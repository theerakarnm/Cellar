/** backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump - date parts are UTC. */
export function buildBackupKey(targetId: string, dbName: string, at: Date): string {
  const iso = at.toISOString();
  const [year, month, day] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  return `backups/${targetId}/${year}/${month}/${day}/${iso}_${dbName}.dump`;
}
