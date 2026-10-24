export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JOBS: Queue;
  ENCRYPTION_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_BYPASS?: string;
}
