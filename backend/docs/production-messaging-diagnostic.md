# Temporary Render messaging schema diagnostic (no Shell required)

Prepared 2026-10-20. Nothing in this workflow applies a migration. Production
deployment, commit and push still require the owner's approval.

## Confirmed startup failure and correction

The latest supplied Render log says **Missing script: "start:diagnose-messaging"**.
It does not say the normal `start` command is missing. The local backend package
contains `start: node server.js` and the diagnostic commands. The normal `start`
command also exists in the committed backend package.

Read-only GitHub verification found `main` at
`07d19ad725acabda149f38d18263ea018032b0db`. That commit lacks the diagnostic
commands and the diagnostic runner/wrapper files. Those changes are currently
local and uncommitted. The pasted failed-deploy log contains no commit SHA, so
its exact deployed commit cannot be claimed; the verified GitHub branch state
is consistent with the reported missing diagnostic command.

The owner supplied this Render configuration, which is a matching pair:

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `npm install && npx puppeteer browsers install chrome && node scripts/auditDatabaseSchema.js` |
| Temporary Start Command | `npm run start:diagnose-messaging` |
| Linked Branch | `main` |
| Normal Start Command after diagnostics | `npm start` |

Keep those backend-root settings; do not add another `backend/` prefix to the
Start Command. The wrapper resolves its child diagnostic and `server.js` from
its own `__dirname`, with `backend` as the child working directory. No root
package or change to normal `npm start` is needed. The supplied Build Command
was inspected and remains unchanged. Firebase configuration is unaffected.

The correction is to commit/push the complete diagnostic release, including the
backend package changes, before an approved Render deployment. The new offline
`verify:diagnostic-startup` check validates commands and entrypoint files without
starting the backend or touching a database. Its optional `--committed` mode
also checks the contents of HEAD, catching the exact omission found here.

## Six-step implementation and release sequence

1. **Inspect:** reviewed the existing diagnostic, guarded repair runner, migration,
   database configuration and standard startup command. No schema changes are
   needed to enable the diagnostic.
2. **Create the read-only runner:** `scripts/diagnoseMessagingSchema.js` checks
   messaging tables, metadata columns/types, indexes, participant uniqueness,
   retry ledger and table engines. Its restricted database interface exposes
   only approved schema reads, and the existing migration runner receives a
   fixed empty argument list for its check-only plan.
3. **Add temporary deployment startup:** `scripts/startWithMessagingDiagnostic.js`
   filters child stdout to recognized prefixed JSON and suppresses child stderr.
   It starts the existing server after success/failure or a 20-second timeout.
   Normal `npm start` stays unchanged; no public endpoint was introduced.
4. **Test locally:** 18 focused startup/diagnostic/migration tests passed, including a
   real failed child process followed by successful backend fixture startup.
   Tests also cover blocked writes/message-row reads, redaction, composite
   uniqueness, unavailable children, timeout, and shutdown without restart.
   Tests use controlled fixtures and do not connect to Aiven. `npm run` lists
   all diagnostic commands; `npm run verify:diagnostic-startup` passes locally.
   `--committed` currently fails as expected until the new files are committed.
5. **Prepare the approved backend release and collect Logs:** use the exact
   PowerShell and Render settings below. No frontend/Firebase release, new
   secret, production migration or storage change is part of this deployment.
6. **Remove the hook:** collect the sanitized output, restore the exact previous
   Start Command, and review the findings before approving any migration.

## What was inspected

`scripts/diagnoseMessaging.js` reads schema and selected message/conversation
records, and optionally probes storage. `npm run migrate:messaging-storage`
calls `scripts/repairMessagingStorage.js`, which defaults to check-only and
requires explicit database/host identity plus `--apply` before any DDL.

The new deployment diagnostic reads **only schema metadata**, avoiding the
message sampling and storage requests in the older diagnostic. It calls that
same repair runner with a fixed empty argument list. Command-line arguments,
including `--apply`, are never forwarded. The runner's optional report callback
only adds a log prefix; its migration behavior is unchanged.

The runner is additionally given a restricted database interface: it has no
`sync`, record-query, DDL or mutation methods. Its raw-query interface permits
only the exact database-identity and table-engine metadata queries. Enum labels,
column defaults, comments and arbitrary error codes are omitted from logs.

It checks the canonical lowercase tables `messages`, `employermessages`,
`conversations`, `employerconversations`, `conversationparticipants`, and
`message_send_requests`. It reports missing model columns, column types,
expected indexes, retry identity uniqueness, table mappings and InnoDB readiness,
then prints the migration's dry-run changes. Missing performance/uniqueness
indexes or non-InnoDB tables may need separate review; the additive migration
does not automatically repair every index or convert engines.

No application rows, attachments, filenames, user identities, provider requests,
passwords, database names/hosts, connection URLs, tokens, SQL text or raw errors
are printed. There is no diagnostic HTTP endpoint or startup synchronization.

## Exact temporary Render configuration

In Render Dashboard, select the **existing backend Web Service**, then Settings.
Record its current Root Directory, Branch, Build Command and Start Command.
Keep the existing Root Directory (`backend` if that is what the service uses),
existing Build Command, Branch, and all production environment variables.

Change only **Start Command** to:

```sh
npm run start:diagnose-messaging
```

This assumes the existing command runs from the backend directory, as
`npm start` / `node server.js` do. If the service instead runs from the repository
root, use:

```sh
npm --prefix backend run start:diagnose-messaging
```

No new environment variables are needed. Existing `NODE_ENV=production`,
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, and the backend's existing
database/TLS configuration are reused. Do not copy credentials into commands,
Git, logs, screenshots or this document. Leave `ENABLE_DB_SYNC` disabled.
Do not add a migration command to Build Command or Pre-Deploy Command.

The wrapper runs the diagnostic in a separate child with a **20-second limit**,
then launches the normal `server.js`. Connection failures, invalid schemas,
child crashes and timeouts do not prevent normal startup. Unexpected diagnostic
stderr and unrecognized stdout are suppressed; known failures have sanitized JSON summaries. Normal
backend logs remain available. The normal backend can still fail for an
independent existing configuration/database problem.

This is a startup hook: while configured, it runs on each service restart as
well as deployment. Remove the temporary command after collecting evidence.

## Review and Git commands (do not execute until approved)

The current local branch is `main`. Confirm Render's linked branch in Settings
before pushing; substitute its actual name if different. A push can trigger
Render Auto-Deploy. No commit, push or deployment has been executed by Codex.

These commands stage only the diagnostic files, keeping the attachment/viewer
changes and unrelated workspace edits outside this diagnostic commit:

```powershell
Set-Location C:\Alumni
git status --short
if (git diff --cached --name-only) { throw "Review existing staged changes before preparing the diagnostic commit." }
node --test backend/tests/diagnosticStartupConfiguration.test.js backend/tests/productionMessagingDiagnostic.test.js backend/tests/messagingSchema.test.js
if ($LASTEXITCODE -ne 0) { throw "Diagnostic tests failed; stop before committing." }
npm.cmd --prefix backend run verify:diagnostic-startup
if ($LASTEXITCODE -ne 0) { throw "Local startup files/scripts are incomplete." }
git add -- backend/package.json backend/scripts/repairMessagingStorage.js backend/scripts/diagnoseMessagingSchema.js backend/scripts/startWithMessagingDiagnostic.js backend/scripts/checkMessagingDiagnosticStartup.js backend/tests/productionMessagingDiagnostic.test.js backend/tests/diagnosticStartupConfiguration.test.js backend/docs/production-messaging-diagnostic.md
if ($LASTEXITCODE -ne 0) { throw "Could not stage diagnostic files." }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw "Staged diff checks failed." }
git diff --cached
git commit -m "Fix temporary messaging diagnostic release [skip render]"
if ($LASTEXITCODE -ne 0) { throw "Commit failed; do not push." }
npm.cmd --prefix backend run verify:diagnostic-startup -- --committed
if ($LASTEXITCODE -ne 0) { throw "Committed release is incomplete; do not push." }
git push origin main
if ($LASTEXITCODE -ne 0) { throw "Push failed." }
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Review the staged diff for unrelated files already staged before this task.
`[skip render]` intentionally suppresses Render Auto-Deploy for this commit,
so pushing the correction does not deploy it. The final two commands should
show the same commit SHA. Open that commit on GitHub and check
`backend/package.json`, `backend/scripts/startWithMessagingDiagnostic.js`, and
`backend/scripts/diagnoseMessagingSchema.js` before deployment.

After explicit deployment approval, keep the supplied backend-root configuration
and use **Manual Deploy > Deploy latest commit**. Compare the deploy's commit
SHA with the value from `git rev-parse HEAD`. Do not deploy the unrelated frontend
changes or use a migration command in this diagnostic-only release.

## Find and interpret the output

Open the backend service's **Logs** in Render Dashboard, select the deployment's
runtime logs, and search for:

```text
[messaging-schema-diagnostic]
```

Look for `begin`, one `table` line per messaging model,
`migration-dry-run`, `complete`, then `startup_hook_finished`. The last line
confirms `backendWillStart:true`. These are runtime logs, not just build logs.

Example of a missing retry ledger (illustrative; not an Aiven finding):

```text
[messaging-schema-diagnostic] {"event":"table","table":"message_send_requests","status":"missing","matchingTables":0}
[messaging-schema-diagnostic] {"event":"migration-dry-run","mode":"check-only","changes":[{"action":"create_ledger","table":"message_send_requests"}]}
```

`missing_columns` lists the exact absent columns. A dry-run `widen` for
`messages.file_url` or `employermessages.attachment` identifies an undersized
reference column. `case_or_mapping_review` means table casing/duplicates need
review, not that a parallel table should be created.

`manual_schema_review_required` means the existing migration refused an
unsupported schema; use the preceding table summaries for diagnosis.
`unavailable` or `diagnostic_timeout` means evidence is incomplete, not that the
schema is healthy. No successful production repair is implied by any output.

An empty migration plan does not override reported missing indexes or an engine
warning: those can require a separate reviewed correction. The temporary hook
does not add indexes, convert table engines, or repair data.

Copy the complete prefixed lines back for review. Do not include unrelated
logs containing secrets or personal information. The exact production root
cause will be determined from this output before proposing any migration.

## Remove the temporary hook

After collecting the diagnostic output:

1. Restore the **exact original Start Command** in Render Settings. For the
   standard backend-root configuration this is `npm start` (or `node server.js`
   if that was its original value). Repository-root equivalent:
   `npm --prefix backend start`.
2. Save and redeploy with the normal command. Confirm normal startup and that
   new startup logs have no diagnostic prefix.
3. The diagnostic files are inert under normal startup. To remove them from Git
   too, remove `start:diagnose-messaging`, `diagnose:messaging-schema` and
   `verify:diagnostic-startup` from
   `backend/package.json`, delete only `scripts/startWithMessagingDiagnostic.js`,
   `scripts/diagnoseMessagingSchema.js`, `scripts/checkMessagingDiagnosticStartup.js`
   and their dedicated tests after review,
   and commit/push those explicit removals only after approval. The report
   callback in the normal migration runner is harmless and can remain.

Do not use `git reset --hard`, blanket `git restore`, or delete upload folders.
Do not run `--apply`, `sequelize.sync`, table recreation or record cleanup to
collect diagnostics. Production migrations require a separate reviewed backup,
plan and explicit owner approval.

Render UI references checked for this workflow:
[deploy commands and Manual Deploy](https://render.com/docs/deploys),
[runtime Logs](https://render.com/docs/logging).
