# Demo environment

A repeatable, presentation-ready dataset for InfraPilot. One command fills a local MongoDB with a
coherent mid-sized organisation — users, assets, monitoring targets with history, incidents,
security findings, maintenance windows, change requests and notifications — and every record is
written through the application's own service layer, so the audit trail, notifications and the
change-approval workflow behave exactly as they do in the product.

```powershell
npm run db:seed:demo -- --dry-run   # validate the dataset, write nothing
npm run db:seed:demo                # create or refresh the demo data
npm run db:verify:demo              # check integrity, workflow rules and dashboard parity
```

Only MongoDB is used. PostgreSQL, Drizzle and `pg` are not involved, and no production
configuration is read or modified.

---

## 1. What you get

| Area | Records | Highlights |
| --- | --- | --- |
| Accounts | 5 | 1 administrator, 3 operators (infrastructure, cloud, security), 1 read-only viewer |
| Assets | 28 | Production / testing / development; servers, databases, network devices, cloud resources, workstations |
| Monitoring targets | 12 | HTTP and TCP checks on loopback endpoints only; healthy, degraded, unavailable and paused states |
| Monitoring history | 744 results | Seven days per target so the trend chart, uptime and recent-result panels are populated |
| Incidents | 10 | Critical to low, every workflow state, affected assets, timelines and documented resolutions |
| Security findings | 12 | Critical/high/medium/low/informational across open, in progress, resolved and accepted risk |
| Maintenance windows | 8 | Scheduled (inside and outside the 14-day dashboard horizon), in progress, completed, cancelled |
| Change requests | 8 | Draft, pending approval, approved, rejected, implemented, rolled back and cancelled |
| Notifications | 14 | Read and unread, linked to real demo incidents, findings, changes and maintenance windows |
| Audit log | everything above | Service-generated entries plus a few rows explicitly labelled `Demo history:` |

Assets deliberately spread across environments, types and statuses so filters, charts and the
dashboard segments all show something other than an empty state.

## 2. Prerequisites

- Node.js 22 and `npm ci` completed.
- A MongoDB replica set (the repository's local setup: `npm run db:init:mongo`, or Docker as in the
  README). The seeder does not start databases.
- A `.env` (or `.env.local`) file based on `.env.example` containing at least:

  ```
  MONGODB_URI=mongodb://127.0.0.1:27017/infrapilot?replicaSet=rs0
  MONGODB_DB=infrapilot
  JWT_ACCESS_SECRET=<32+ characters>
  DEMO_SEED_PASSWORD=<the password you want for the demo accounts>
  ```

`DEMO_SEED_PASSWORD` is required only for the seed run; it is hashed with the application's own
Bcrypt-equivalent hasher and is never logged, stored in the dataset, or written to the audit trail.
Optional variables: `DEMO_EMAIL_DOMAIN` (default `infrapilot.local`) and `DEMO_RESET_PASSWORDS=true`
(re-hash existing demo passwords on the next seed run instead of leaving them untouched).

## 3. Exact commands (PowerShell)

```powershell
# from the repository root
Set-Location C:\code\infrapilot

# 0) one-time configuration
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env    # set MONGODB_URI, JWT_ACCESS_SECRET and DEMO_SEED_PASSWORD
$env:DEMO_SEED_PASSWORD = "Demo-Only-Password-2026!"   # or rely on the value in .env

# 1) database
npm ci
npm run db:init:mongo          # idempotent collections, indexes and counters
npm run db:seed:mongo          # optional: the regular local accounts (admin/operator/viewer)

# 2) demo data
npm run db:seed:demo -- --dry-run
npm run db:seed:demo
npm run db:verify:demo

# 3) run the application (three terminals, same .env)
npm run dev:backend            # http://127.0.0.1:4000
npm run dev:worker             # monitors the demo targets, loopback only
npm run dev                    # http://localhost:3000
```

Then open <http://localhost:3000> and sign in as `demo.admin@infrapilot.local` with the value of
`DEMO_SEED_PASSWORD`.

Refresh the demo later with the same two commands; nothing is duplicated. Remove it again with:

```powershell
npm run db:seed:demo:cleanup -- --yes
npm run db:verify:demo -- --expect-empty
```

`--yes` (or `--confirm-demo-data`) is mandatory. Without it the cleanup exits with code 2 and
deletes nothing.

## 4. Demo accounts

| Email | Role | Title used in the scenario | Can |
| --- | --- | --- | --- |
| `demo.admin@infrapilot.local` | admin | System Administrator | everything, including users, approvals and private-network monitoring |
| `demo.operator@infrapilot.local` | operator | Infrastructure Engineer | create/edit assets, incidents, findings, maintenance and changes |
| `demo.cloud@infrapilot.local` | operator | Cloud Engineer | same as operator, owns the cloud/database estate |
| `demo.security@infrapilot.local` | operator | Security Analyst | same as operator, owns findings and network devices |
| `demo.auditor@infrapilot.local` | viewer | Read-only Auditor | read-only; no create, edit or delete controls |

Passwords come from `DEMO_SEED_PASSWORD`. Job titles are documentation only — the application
implements exactly three roles (`admin`, `operator`, `viewer`).

## 5. Scenario walkthroughs

Each walkthrough uses only shipped screens. Names in **bold** are the exact seeded records to look
for; nothing below requires you to edit the dataset.

### 5.1 Operations triage (5 minutes)

1. Sign in as **demo.admin** and stay on the dashboard.
2. Point out **Registered assets 28**, **Monitored services**, and the *Services needing attention*
   list containing **prd-db-02 replica PostgreSQL (TCP)** and **prd-backup-01 job service (HTTP)**.
3. Open **Incidents** → **Database replica prd-db-02 not accepting connections**. The detail page
   shows the assignments, the timeline ("Status changed … by Marcus Bell", the two authored
   updates), root cause and resolution fields.
4. Add a comment in *Manage incident* — it appears in the timeline immediately and audits as
   `incident.comment_added`.
5. Return to the dashboard: **Open incidents** and *Active incidents* both reflect the state you
   just changed. Nothing on this page is hardcoded.

### 5.2 Security remediation (5 minutes)

1. Open **Security findings**. Filter severity *Critical* → **TLS 1.0 and 1.1 still enabled on the
   storefront listener** and **Firewall management interface reachable from the user VLAN**.
2. Open the TLS finding and note the description states it is demonstration data, not scan output.
3. Set *Remediation status* to **Accepted risk**: the API rejects the change without a
   justification note (that gate is real). Enter a note and save; the event history gains an entry.
4. Show the linked change **Restrict firewall management access to the management VLAN** in
   *Change management* — it is already **Implemented**, which closes the loop between finding and
   change.

### 5.3 Change approval (5 minutes)

1. Sign in as **demo.cloud** (requester of **Upgrade prd-db-01 to PostgreSQL 16.4**). The request is
   **Pending approval** and the requester cannot approve it (separation of duties is enforced).
2. Sign in as **demo.admin** and approve it with a comment. Status becomes **Approved** once the
   configured number of approvals is reached (`REQUIRED_CHANGE_APPROVALS`, default 1; set it to 2 and
   re-seed to demonstrate a two-person rule).
3. Back as **demo.cloud**, the notification bell shows the decision notification and the change can
   now be implemented, rolled back or cancelled from the detail panel.
4. Mention **Deploy checkout service release 2026.7.2** (approved) and **Deploy monitoring agent to
   the k3s nodes** (rolled back with notes) as the "before" and "after" states of the same workflow.

### 5.4 Maintenance and patching (3 minutes)

1. Open **Maintenance**. **Monthly Windows security patching** is scheduled, **Backup verification
   and restore test** is **In progress**, **Core switch firmware and configuration backup** is
   completed and the cancelled window explains why it was cancelled.
2. Show the dashboard *Upcoming maintenance* card: it lists only scheduled windows inside 14 days,
   which is why the firewall firmware window (+21 days) appears on the maintenance page but not on
   the dashboard.
3. Start and complete a window from the maintenance form to demonstrate the allowed transitions.

### 5.5 Inventory and read-only access (3 minutes)

1. Open **Assets**, search `10.20.10` or filter environment *production* / type *network_device*.
2. Export CSV: the file contains the seeded inventory, including descriptions that carry the asset
   tag, department and criticality (the schema does not model those three fields individually).
3. Sign out and sign in as **demo.auditor**. The inventory, incidents and findings are visible, but
   *Register asset*, *Import CSV*, edit and delete controls are absent, and the *Users & access* area
   is hidden. Attempting a write against the API returns 403 — the controls are a convenience, the
   server enforces the role.

### 5.6 Search, filters and notifications (2 minutes)

1. **Monitoring**: filter *Unavailable* → two services; search `paused` target
   **WinRM (HTTP)** to show the paused state.
2. **Notifications**: filter *Unread* to show the monitoring failure, critical finding, pending
   approval and maintenance reminder. Each link opens the corresponding record.
3. **Users & access**: the five demo accounts and their roles; the audit log tab contains the
   service-generated entries plus rows prefixed `Demo history:` which describe seeded narration, not
   real sign-ins.

## 6. What is real and what is illustrative

- **Real**: validation, RBAC, audit entries, notifications, approval rules, status transitions and
  every dashboard figure. All of them are produced by calling the same service functions the HTTP
  API calls, and `npm run db:verify:demo` re-derives the dashboard KPIs from raw documents to prove
  it.
- **Illustrative**: the fictional organisation, hostnames, IP addresses and the monitoring history
  points. History is generated deterministically from the target configuration, not captured from a
  live system.
- **Not claimed**: the security findings were not produced by a vulnerability scan. Every finding
  description says so explicitly, and no CVE identifiers are invented.
- **Loopback only**: every monitoring target resolves to `127.0.0.1` (the demo host). Nothing
  external is probed, and the targets are created with `allowPrivateNetwork` by an administrator
  because the API forbids private destinations otherwise.
- **Marker**: every seeded document carries `demoBatch: "infrapilot-demo-v1"`, `demoSource:
  "demo-seed"` and `demoKey`. The seeder updates or deletes only documents with that marker.

### Live monitoring after seeding

The worker keeps probing the demo targets while it runs, so states and response times move away
from the seeded snapshot — that is the product doing its job. To freeze the presentation, stop the
worker (`Ctrl+C` in its terminal) or pause the checks on the **Monitoring** page. The unavailable
services (`prd-db-02` on port 5432, `prd-backup-01` on port 9) stay unavailable because those ports
are closed.

## 7. Ownership, idempotency and cleanup

- First run creates records; later runs update only those records when a tracked field changed, and
  skip everything else. Counters (`incident_number`, `change_number`) are never reset, so reference
  numbers keep increasing across runs — the demo narrative does not depend on specific numbers.
- The seeder refuses to modify an account that already exists without the demo marker and tells you
  to pick another `DEMO_EMAIL_DOMAIN`.
- Cleanup deletes demo records collection by collection (children first), removes session artifacts
  of the demo accounts, then deletes the accounts themselves.
- Before deleting anything, cleanup verifies that no demo account owns a non-demo record (an asset,
  incident, finding, change, comment, approval or audit entry created outside the dataset). If one
  exists it aborts with the list of offending references so that real work is never lost.
- Existing users, assets, incidents, audit entries and counters created by anybody else are never
  touched.

## 8. Verification

`npm run db:verify:demo` exits non-zero if any check fails. It covers:

1. **Counts** per collection against the dataset plan.
2. **Referential integrity** — owners, assignees, linked assets, approvers, notification links.
3. **Workflow consistency** — resolutions and root causes for resolved/closed incidents,
   `resolvedAt` for resolved findings, `start < end` for maintenance, distinct approvals from users
   other than the requester, implementation and rollback notes.
4. **Dashboard parity** — `getDashboard(7)` is called and every KPI is compared with a raw count
   (total/healthy assets, open incidents, critical & high open findings, upcoming maintenance,
   monitored services), and the trend/attention/recent lists must be non-empty.
5. **Credential check** — when `DEMO_SEED_PASSWORD` is set, the hashed password verifies.

After cleanup, `npm run db:verify:demo -- --expect-empty` asserts that no demo record remains in any
collection.

`e2e/demo-environment.spec.ts` renders the same data through the browser (dashboard attention list,
asset detail with its linked monitor, monitoring states, incident timeline, finding edit dialog,
change statuses, maintenance, notifications, user directory and the read-only viewer). It is skipped
unless `DEMO_SEED_PASSWORD` is set, and CI runs the full sequence: dry run → seed twice → verify →
cleanup → expect-empty → re-seed → Playwright.

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DEMO_SEED_PASSWORD is required` | Export the variable or add it to `.env`, then re-run. |
| `Refusing to modify …` | The account exists without the demo marker. Change `DEMO_EMAIL_DOMAIN` or remove the account. |
| `Cleanup aborted: demo accounts own records…` | Real records reference a demo account. Reassign or remove them, then retry. |
| `Change … ended in status pending_approval` | `REQUIRED_CHANGE_APPROVALS` is higher than the number of available approvers. Lower it to 1–4 and re-run. |
| `connect ECONNREFUSED 127.0.0.1:27017` | MongoDB is not running or is not a replica set. Run `npm run db:init:mongo`. |
| Dashboard shows different numbers than this document | The worker re-checked the targets, or a scenario changed records — expected. Re-seed or restart the demo. |
| `MONGODB_URI is required` | `.env` is missing for the process; the seeder loads `.env`/`.env.local` from the repository root. |

## 10. Known schema gaps (by design)

The demo does not invent fields. Three presentation ideas are expressed through existing fields and
documented here instead:

- **Asset tag, department and criticality** have no columns in the asset model; they are written
  into the asset description as a prefixed sentence so the inventory still reads like a real CMDB.
- **Workstations and laptops** are stored as type `other` (the model has eight fixed types and no
  workstation type), with the operating system naming the hardware.
- **CVE identifiers** are omitted rather than fabricated; findings carry remediation guidance and an
  explicit demonstration-data note.
