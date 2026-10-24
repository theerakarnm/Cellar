import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AlertChannel, TargetSummary } from "../api/types";
import { TestConnection } from "../components/TestConnection";
import { ErrorNote, Field, Loading, SecretBadge } from "../components/ui";
import { emptyFormValues, fieldErrors, targetToFormValues, toPayload, type FormValues } from "../lib/form";
import { createTargetSchema, updateTargetSchema } from "../lib/schemas";

export function TargetForm() {
  const { id } = useParams();
  const mode = id ? "edit" : "create";
  const target = useLoad(async () => (id ? api<TargetSummary>("GET", `/api/targets/${id}`) : undefined), [id]);
  const channels = useLoad(() => listAll<AlertChannel>("/api/alert-channels"), []);
  if (target.error) return <ErrorNote error={target.error} />;
  if (target.loading || channels.loading) return <Loading loading hasData={false} />;
  return <TargetFormBody mode={mode} target={target.data} channels={channels.data ?? []} />;
}

function TargetFormBody({ mode, target, channels }: { mode: "create" | "edit"; target: TargetSummary | undefined; channels: AlertChannel[] }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(() => (target ? targetToFormValues(target) : emptyFormValues()));
  const [channelIds, setChannelIds] = useState<string[]>(target?.alertChannelIds ?? []);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<Error | undefined>();

  const payload = toPayload(values, mode, channelIds);
  // Create sends every tunnel field so blank ones report their own message instead of a pathless "tunnel" error.
  if (mode === "create") {
    payload.tunnel = { hostname: values["tunnel.hostname"]?.trim(), tokenId: values["tunnel.tokenId"], tokenSecret: values["tunnel.tokenSecret"] };
  }
  const parsed = (mode === "create" ? createTargetSchema : updateTargetSchema).safeParse(payload);
  const errors = parsed.success ? {} : fieldErrors(parsed.error.issues);
  const shown = (key: string) => (submitted || touched.has(key) ? errors[key] : undefined);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const input = (key: string, props: { type?: string; placeholder?: string; inputMode?: "numeric"; list?: string } = {}) => (
    <input
      list={props.list}
      value={values[key] ?? ""}
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      placeholder={props.placeholder}
      autoComplete={props.type === "password" ? "new-password" : "off"}
      aria-invalid={shown(key) ? true : undefined}
      onChange={(e) => set(key, e.target.value)}
      onBlur={() => setTouched((prev) => new Set(prev).add(key))}
    />
  );
  const secretInput = (key: string, isSet: boolean, label: string) => (
    <Field label={label} error={shown(key)} hint={mode === "edit" ? "Write-only. Leave blank to keep the stored value." : undefined}>
      <span className="secret-state">
        <SecretBadge isSet={isSet} />
      </span>
      {input(key, { type: "password" })}
    </Field>
  );
  const number = (key: string, label: string, hint?: string) => (
    <Field label={label} error={shown(key)} {...(hint ? { hint } : {})}>
      {input(key, { inputMode: "numeric" })}
    </Field>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!parsed.success) return;
    setSaving(true);
    setServerError(undefined);
    try {
      const saved = mode === "create" ? await api<TargetSummary>("POST", "/api/targets", payload) : await api<TargetSummary>("PATCH", `/api/targets/${target?.id}`, payload);
      navigate(`/targets/${saved.id}`);
    } catch (e) {
      setServerError(e instanceof Error ? e : new Error(String(e)));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form">
      <h1>{mode === "create" ? "New target" : `Edit ${target?.name ?? ""}`}</h1>
      <ErrorNote error={serverError} />
      {errors._form && submitted ? <p className="note note-error">{errors._form}</p> : null}

      <fieldset>
        <legend>General</legend>
        <Field label="Name" error={shown("name")}>
          {input("name")}
        </Field>
        <Field label="Project tag" error={shown("projectTag")} hint="Optional. Shown on the dashboard and in alerts.">
          {input("projectTag")}
        </Field>
        {mode === "edit" ? (
          <label className="check">
            <input type="checkbox" checked={values.enabled === "true"} onChange={(e) => set("enabled", String(e.target.checked))} />
            Enabled (scheduled backups run)
          </label>
        ) : (
          <p className="note">
            A new target is saved disabled. After saving: 1. Test connection. 2. Enable the target. Nothing runs on a schedule until you enable it.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Connection</legend>
        {mode === "edit" && target ? (
          <p className="hint">
            Current: <span className="mono">{target.connection.user}@{target.connection.host}:{target.connection.port}/{target.connection.dbName}</span>
          </p>
        ) : null}
        {secretInput("connectionUrl", target !== undefined, "Connection URL (backup role)")}
        {secretInput("restoreUrl", target?.hasRestoreUrl ?? false, "Restore connection URL (optional)")}
        <Field label="Tunnel hostname" error={shown("tunnel.hostname")}>
          {input("tunnel.hostname", { placeholder: "db.example.com" })}
        </Field>
        {secretInput("tunnel.tokenId", target?.hasTunnelToken ?? false, "Service token client id")}
        {secretInput("tunnel.tokenSecret", target?.hasTunnelToken ?? false, "Service token client secret")}
        {mode === "edit" && target ? <TestConnection targetId={target.id} /> : <p className="hint">Test connection runs on the saved target. Save it first (it stays disabled), then test it on its page.</p>}
      </fieldset>

      <fieldset>
        <legend>Schedule</legend>
        <Field label="Cron (5 fields)" error={shown("scheduleCron")}>
          {input("scheduleCron")}
        </Field>
        <Field label="Time zone" error={shown("timezone")}>
          <>
            {input("timezone", { list: "timezones" })}
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Retention</legend>
        <div className="grid">
          {number("retention.keepLast", "Keep last")}
          {number("retention.daily", "Daily")}
          {number("retention.weekly", "Weekly")}
          {number("retention.monthly", "Monthly")}
          {number("retention.maxAgeDays", "Max age (days)", "Blank = off")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Advanced</legend>
        <div className="grid">
          {number("jobDeadlineMinutes", "Job deadline (min)")}
          {number("staleAfterHours", "Stale after (hours)", "Blank = schedule interval + 2\u00a0h")}
          {number("alertFailureThreshold", "Alert after N consecutive failures")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Alert channels</legend>
        {channels.length === 0 ? (
          <p className="muted">
            No channels yet. Add one in <Link to="/settings">Settings</Link>. A target with no channel gets no alerts.
          </p>
        ) : (
          channels.map((channel) => (
            <label className="check" key={channel.id}>
              <input
                type="checkbox"
                checked={channelIds.includes(channel.id)}
                onChange={(e) => setChannelIds((prev) => (e.target.checked ? [...prev, channel.id] : prev.filter((x) => x !== channel.id)))}
              />
              {channel.name} <span className="muted">({channel.type})</span>
            </label>
          ))
        )}
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving..." : mode === "create" ? "Create target" : "Save changes"}
        </button>
        <Link className="button" to={target ? `/targets/${target.id}` : "/targets"}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
