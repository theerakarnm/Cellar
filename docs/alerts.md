# Alerts

Cellar sends alerts to LINE and Discord when a backup needs attention.

## Events

- `backup_failed`: a backup ended as `failed` or `timed_out`.
  Sent on every failure.
- `backup_consecutive_failures`: a target reached N failures in a row.
  The default N is 3, and it is set per target on the target form or API.
  Sent once.
  A success resets the count and re-arms the alert.
- `backup_stale`: a target has no successful backup within its stale limit.
  Sent once per stale episode.
  The next success re-arms it.
- `retention_failed` and `restore_finished` can be selected on a channel, but Cellar does not send them yet.

On the Nth failure a channel that listens to both `backup_failed` and `backup_consecutive_failures` gets two messages.

## Who receives alerts

A target sends alerts only to channels that are linked to it, enabled, and subscribed to the event.
A target with no linked channel gets no alerts.
Link channels to a target on the target form.

## Stale limit

Set `stale_after_hours` on the target (target form or API) to choose the limit.
If it is empty, Cellar uses the expected gap between runs of the schedule plus 2 hours.
A daily schedule gives 26 hours.
A target that never succeeded is measured from its creation time.
Disabled and deleted targets are never checked.

## Channels

Create channels under Settings, or with `POST /api/alert-channels`.
Credentials are encrypted and cannot be read back.
Use `POST /api/alert-channels/:id/test` to send a test message.

### LINE

Needs a Messaging API channel access token and the id of the user, group, or room to message (`to`).
The account must be allowed to push to that id (the user added the account as a friend, or the account joined the group).
Cellar uses the push message endpoint.
Push messages count against the account's monthly message quota [uncertain: check your LINE plan].

### Discord

Needs a channel webhook URL (Channel settings, Integrations, Webhooks).
Only URLs that start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/` are accepted.
Mentions in messages are disabled.

## Message

Each message has the target name, project tag, the event, a redacted error summary, the time in the target's timezone, and a link to `${APP_BASE_URL}/targets/<id>`.
Set `APP_BASE_URL` in `wrangler.jsonc` `vars` (and `.dev.vars` locally).

## Failures

If LINE or Discord rejects a message, Cellar writes one log line with the channel id and the HTTP status.
Each send uses a 10 second request timeout and does not follow redirects.
It never retries and never fails the backup because of an alert.
Logs never contain tokens, webhook URLs, or connection strings.
