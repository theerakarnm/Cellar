import { z } from "zod";
import { validateCron } from "./cron";
import { parsePgUrl } from "./pg-url";
import { isValidTimeZone } from "./tz";

export const TARGET_DEFAULTS = {
  scheduleCron: "0 2 * * *",
  timezone: "Asia/Bangkok",
  keepLast: 3,
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 6,
  maxAgeDays: null,
  jobDeadlineMinutes: 120,
  alertFailureThreshold: 3,
} as const;

const pgUrl = z
  .string()
  .max(2048)
  .refine((value) => parsePgUrl(value) !== null, "Must be a postgres:// or postgresql:// URL with a user, a host, and a database name");

const cron = z.string().superRefine((value, ctx) => {
  const error = validateCron(value);
  if (error) ctx.addIssue({ code: "custom", message: error });
});

const timezone = z.string().refine(isValidTimeZone, "Must be an IANA time zone such as Asia/Bangkok");

const hostname = z
  .string()
  .max(253)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/, "Must be a hostname such as db.example.com");

const keepCount = z.number().int().min(0).max(10_000).nullable();
const maxAgeDays = z.number().int().min(1).max(36_500).nullable();
const name = z.string().trim().min(1).max(100);
const projectTag = z.string().trim().min(1).max(50).nullable();
const jobDeadlineMinutes = z.number().int().min(5).max(1440);
const staleAfterHours = z.number().int().min(1).max(8760).nullable();
const alertFailureThreshold = z.number().int().min(1).max(100);
const alertChannelIds = z
  .array(z.string().min(1))
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const retention = z
  .object({ keepLast: keepCount.optional(), daily: keepCount.optional(), weekly: keepCount.optional(), monthly: keepCount.optional(), maxAgeDays: maxAgeDays.optional() })
  .strict();

const tunnel = z.object({ hostname, tokenId: z.string().min(1).max(512), tokenSecret: z.string().min(1).max(1024) }).strict();

export const createTargetSchema = z
  .object({
    name,
    projectTag: projectTag.optional(),
    connectionUrl: pgUrl,
    restoreUrl: pgUrl.nullable().optional(),
    tunnel,
    scheduleCron: cron.default(TARGET_DEFAULTS.scheduleCron),
    timezone: timezone.default(TARGET_DEFAULTS.timezone),
    retention: retention.optional(),
    jobDeadlineMinutes: jobDeadlineMinutes.default(TARGET_DEFAULTS.jobDeadlineMinutes),
    staleAfterHours: staleAfterHours.optional(),
    alertFailureThreshold: alertFailureThreshold.default(TARGET_DEFAULTS.alertFailureThreshold),
    enabled: z.boolean().default(true),
    alertChannelIds: alertChannelIds.default([]),
  })
  .strict();

export const updateTargetSchema = z
  .object({
    name: name.optional(),
    projectTag: projectTag.optional(),
    connectionUrl: pgUrl.optional(),
    restoreUrl: pgUrl.nullable().optional(),
    tunnel: tunnel.partial().strict().optional(),
    scheduleCron: cron.optional(),
    timezone: timezone.optional(),
    retention: retention.optional(),
    jobDeadlineMinutes: jobDeadlineMinutes.optional(),
    staleAfterHours: staleAfterHours.optional(),
    alertFailureThreshold: alertFailureThreshold.optional(),
    enabled: z.boolean().optional(),
    alertChannelIds: alertChannelIds.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.values(value).every((field) => field === undefined)) {
      ctx.addIssue({ code: "custom", message: "At least one field is required" });
    }
  });

export type CreateTargetInput = z.output<typeof createTargetSchema>;
export type UpdateTargetInput = z.output<typeof updateTargetSchema>;
