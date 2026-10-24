import { useState } from "react";
import { api, listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AlertChannel } from "../api/types";
import { CHANNEL_EVENTS, channelPayload, channelToForm, emptyChannelForm, type ChannelForm } from "../lib/channel";
import { Dialog, ErrorNote, Field, SecretBadge } from "./ui";

export function ChannelsSection() {
  const channels = useLoad(() => listAll<AlertChannel>("/api/alert-channels"), []);
  const [editing, setEditing] = useState<{ id: string | null; form: ChannelForm } | undefined>();
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | undefined>();
  const fail = (e: unknown) => setError(e instanceof Error ? e : new Error(String(e)));

  async function test(channel: AlertChannel) {
    setTestResult((prev) => ({ ...prev, [channel.id]: "Sending..." }));
    try {
      const result = await api<{ ok: boolean; error?: string }>("POST", `/api/alert-channels/${channel.id}/test`);
      setTestResult((prev) => ({ ...prev, [channel.id]: result.ok ? "Sent" : `Failed: ${result.error ?? "no details"}` }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [channel.id]: `Failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  async function remove(channel: AlertChannel) {
    if (!window.confirm(`Delete alert channel "${channel.name}"?`)) return;
    try {
      await api("DELETE", `/api/alert-channels/${channel.id}`);
      channels.reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section aria-labelledby="channels-heading">
      <div className="page-head">
        <h2 id="channels-heading">Alert channels</h2>
        <button type="button" onClick={() => setEditing({ id: null, form: emptyChannelForm() })}>
          Add channel
        </button>
      </div>
      <ErrorNote error={channels.error ?? error} />
      {channels.data?.length === 0 ? <p className="muted">No channels. Targets with no linked channel get no alerts.</p> : null}
      {channels.data && channels.data.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Credential</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {channels.data.map((channel) => (
              <tr key={channel.id}>
                <td data-label="Name">{channel.name}</td>
                <td data-label="Type">{channel.type}</td>
                <td data-label="Credential">
                  <SecretBadge isSet={channel.hasCredential} />
                </td>
                <td data-label="Enabled">{channel.enabled ? "yes" : "no"}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => test(channel)}>
                    Test
                  </button>
                  <button type="button" onClick={() => setEditing({ id: channel.id, form: channelToForm(channel) })}>
                    Edit
                  </button>
                  <button type="button" onClick={() => remove(channel)}>
                    Delete
                  </button>
                  {testResult[channel.id] ? <span className="hint" role="status">{testResult[channel.id]}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Dialog open={editing !== undefined} title={editing?.id ? "Edit channel" : "Add channel"} onClose={() => setEditing(undefined)}>
        {editing ? (
          <ChannelFormView
            initial={editing.form}
            id={editing.id}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              channels.reload();
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function ChannelFormView({ initial, id, onClose, onSaved }: { initial: ChannelForm; id: string | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<Error | undefined>();
  const mode = id ? "edit" : "create";
  const patch = (change: Partial<ChannelForm>) => setForm((prev) => ({ ...prev, ...change }));

  async function save() {
    const built = channelPayload(form, mode);
    if ("error" in built) return setError(new Error(built.error));
    try {
      await (id ? api("PATCH", `/api/alert-channels/${id}`, built.body) : api("POST", "/api/alert-channels", built.body));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ErrorNote error={error} />
      <Field label="Type">
        <select value={form.type} disabled={mode === "edit"} onChange={(e) => patch({ type: e.target.value === "line" ? "line" : "discord" })}>
          <option value="discord">Discord webhook</option>
          <option value="line">LINE push</option>
        </select>
      </Field>
      <Field label="Name">
        <input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      {mode === "edit" ? (
        <label className="check">
          <input type="checkbox" checked={form.replaceCredential} onChange={(e) => patch({ replaceCredential: e.target.checked })} />
          Replace the stored credential (write-only)
        </label>
      ) : null}
      {form.replaceCredential && form.type === "line" ? (
        <>
          <Field label="Channel access token">
            <input type="password" autoComplete="off" value={form.token} onChange={(e) => patch({ token: e.target.value })} />
          </Field>
          <Field label="Recipient id (to)">
            <input autoComplete="off" value={form.to} onChange={(e) => patch({ to: e.target.value })} />
          </Field>
        </>
      ) : null}
      {form.replaceCredential && form.type === "discord" ? (
        <Field label="Webhook URL">
          <input type="password" autoComplete="off" value={form.webhookUrl} onChange={(e) => patch({ webhookUrl: e.target.value })} />
        </Field>
      ) : null}
      <fieldset>
        <legend>Events</legend>
        {CHANNEL_EVENTS.map((event) => (
          <label className="check" key={event.value}>
            <input
              type="checkbox"
              checked={form.events.includes(event.value)}
              onChange={(e) => patch({ events: e.target.checked ? [...form.events, event.value] : form.events.filter((x) => x !== event.value) })}
            />
            {event.label}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Enabled
      </label>
      <div className="actions">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
