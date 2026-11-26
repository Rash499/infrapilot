# Frontend modernization — design system and application shell

Interface-only rework of `apps/frontend`. No backend, database, API contract, auth flow or
permission rule was changed. Every figure rendered in the UI still comes from an existing endpoint
(`GET /dashboard`, `/assets`, `/monitoring/*`, `/incidents`, `/security/findings`, `/maintenance`,
`/changes`, `/users`, `/audit`, `/notifications`).

## 1. Design language

| Decision | Implementation |
|---|---|
| Always-dark navigation rail | `--sidebar*` tokens; `bg-sidebar` on the rail and on the auth panel |
| Neutral application canvas | `--canvas`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong` |
| Restrained blue accent | `--accent` / `--accent-hover` / `--accent-soft` / `--accent-ring`; every former `sky-*` brand usage now uses these tokens |
| Status colours | `--st-{neutral,success,warning,danger,info}-{fg,bg,line}` consumed by `.tone-*`, `.dot-*`, badges and alerts |
| Flat surfaces | one card radius (`--radius-card`, 14px), hairline borders, two shadow levels; no gradients, glows or oversized hero cards |
| Typography | system sans stack, `--text-2xs` (11px) micro scale for labels, tabular numerals on tables, metrics and timestamps |
| Focus | global `:focus-visible` 2px `--accent-ring` outline; component-level rings on buttons, links, tabs and rail items |
| Motion | 140–160ms easing for overlay/dialog/toast, disabled by `prefers-reduced-motion` |

Both themes are token-parity complete: `:root` (light) and `.dark` define every surface, accent,
sidebar and status value. The theme is applied before paint by an inline bootstrap script in
`app/layout.tsx`, so there is no flash of the wrong theme, and the choice is persisted under
`infrapilot-theme`.

## 2. Component inventory

All primitives live in `apps/frontend/src/components/ui.tsx` (single source, no duplicates):

`cn`, `Button`, `IconButton`, `Card`, `CardHeader`, `PageContainer`, `PageHeader`, `Toolbar`,
`Segmented`, `Badge`, `StatusBadge`, `StatusDot`, `HealthIndicator`, `SeverityBadge`,
`STATUS_TONE`, `Input`, `Select`, `Textarea`, `Field`, `FormSection`, `SearchInput`, `Checkbox`,
`Modal`, `ConfirmDialog`, `Skeleton`, `TableSkeleton`, `EmptyState`, `ErrorState`, `Alert`,
`StatCard`, `ProgressBar`, `Pagination`, `DataTable`, `Th`, `Td`, `DetailList`, `DetailItem`,
`ActivityTimeline`.

Shell components live in `apps/frontend/src/components/app-shell.tsx`:
`AppShell`, grouped/collapsible `ApplicationSidebar`, sticky header with `Breadcrumbs`,
notification bell, theme toggle, account menu and a focus-trapped mobile drawer.

Charts live in `apps/frontend/src/components/charts.tsx`: `ResponseTrendChart`,
`DistributionChart`, `ChartEmpty`, `TrendPoint`. Both charts render `<figure>` markup with a
`<figcaption>` text summary so the data is available without seeing the plot.

No UI dependency was added; charts still use the existing `recharts` install.

## 3. Shell behaviour

- Nav groups are rendered only where a route exists: Overview (Dashboard), Infrastructure (Assets,
  Monitoring), Operations (Incidents, Maintenance, Change management), Security (Security findings),
  Administration (Users and access — admin only), plus Notifications and Settings in the utility rail.
  There is no "Services" destination because no such route exists.
- Active route is marked with `aria-current="page"`; the collapse toggle persists to
  `infrapilot-sidebar-collapsed` and falls back to the collapsed rail with `aria-label`/`title` on
  every icon-only link.
- Breadcrumbs resolve detail routes (`/assets/[id]`, `/incidents/[id]`) to group → parent → detail.
- Unread notification count is read from the `/notifications` list `meta.unreadCount`.
- Mobile: header menu opens a `role="dialog"` drawer with Escape handling, scroll lock and a Tab
  focus loop.

## 4. Page work

| Page | What changed |
|---|---|
| `/` dashboard | Rebuilt on `Dashboard` data: 8 linked KPI cards, workspace-health banner, health distribution and progress segments, response-trend chart, three distribution charts, attention/overdue service lists, incidents/findings/changes/maintenance panels, 24h/7d/30d/90d segmented range, 60s refresh that pauses on hidden tabs |
| `/assets` | Eyebrow header, toolbar filters, Active/Archived segmented control, sortable columns, row hover, CSV import/export preserved (5 MB cap, per-row validation report now an `Alert`) |
| `/assets/[id]` | Detail list, monitoring/findings/incidents panels, audit trail rendered as `ActivityTimeline`, archive/restore confirm preserved |
| `/monitoring` | Six overview metrics, toolbar filters, 30s polling, run-check-now, delete confirm, `?target=` deep link, detail modal with compact stat strip, 24h chart and recent-results table |
| `/incidents` | Stat strip, five filters, All/Active/Closed segmented control, create modal with `AssetPicker` unchanged |
| `/incidents/[id]` | Lifecycle track from real status values, timeline with comment composer, manage form, details and affected assets |
| `/security` | Severity/status/asset/assignee filters, loaded-findings stat strip with explicit "newest 100" labelling, status and severity distribution panels, remediation modal preserved |
| `/changes` | Risk/status filters, approval transitions and rollback-plan form preserved, unified form errors |
| `/maintenance` | Window form, overlapping-window warnings and cancel confirm preserved, unified form errors |
| `/users` | Tablist (`role="tab"`/`tabpanel`, arrow-key support) for Users and Access vs Audit log, toolbar filters, permission matrix restyled |
| `/settings` | Profile, password and session sections; theme switch is now the shared `Segmented` control |
| `/notifications` | All/Unread segmented scope, per-type icons, unread highlighting, mark-all-read, pagination |
| Auth (`/login`, `/register`, `/forgot-password`) | Split brand panel + form card, inline validation, preserved labels and flows |
| Global | `not-found.tsx`, `error.tsx`, `(app)/loading.tsx`, and a shell-shaped session skeleton replace blank screens |

## 5. Accessibility and responsiveness

- Skip link to `#main` on every layout; single `<h1>` per page from `PageHeader`.
- Dialogs: `role="dialog"`, `aria-modal`, labelled title, Escape to close, focus trap and focus
  restore; destructive actions always confirm (existing confirmations kept, none removed).
- Status is never conveyed by colour alone: every badge pairs a dot with a text label, and charts
  ship a hidden textual summary.
- Form errors use `role="alert"` and are wired through `aria-invalid` on the input; error alerts are
  assertive, informational alerts polite.
- Tables use `<th scope="col">`, horizontal scroll containers with `minWidth`, and truncation via
  `.truncate-cell` rather than wrapping long identifiers.
- Layouts collapse to one column below `sm`, two columns at `sm`, four at `xl`; the rail is replaced
  by the drawer under `lg`.

## 6. Verification record

| Check | Result |
|---|---|
| `npm run typecheck` | Pass — all six workspaces |
| `npm run lint` | Pass — 0 errors, 20 warnings (all pre-existing `react-hooks/set-state-in-effect` advisories in auth/async effects) |
| `npm test` | Pass — 114 tests, 19 files (98 existing + 5 shell + 6 primitives + 2 users tabs + 2 asset form + 1 monitoring form) |
| `npm run build` | Pass — 18 routes, static + dynamic split unchanged |
| Dev-server SSR smoke | `/login`, `/`, `/assets`, `/monitoring`, `/users`, `/settings`, `/notifications` return 200; `/does-not-exist` returns 404 with the branded page; shell skeleton renders server-side so no unauthenticated flash |
| `npm run test:e2e` | Pass in CI — 5 Playwright tests against a MongoDB `rs0` service with seeded data. The first CI run exposed two selector regressions (users tab bar moved to `role="tab"`; `Field`’s `required` marker removed the literal `*` from labels); both were fixed and the label contracts are now pinned by unit tests |
| Visual regression / screenshots | **Not available** — no browser binaries installed |
| Authenticated pop-up/drawer interaction | Verified through component tests (shell nav, breadcrumbs, collapse persistence, unread badge, modal Escape, confirm, segmented, empty/error states) rather than a live browser session |

## 7. Known limitations

- Data-dependent behaviour (polling against the real worker, probe results, seeded demo content)
  could not be exercised without MongoDB; the UI was exercised against component-level fixtures that
  mirror the API contract.
- The dashboard's "newest 100" surfaces (`/security` counters) are intentionally labelled *loaded
  findings* rather than presenting them as totals.
- `react-hooks/set-state-in-effect` warnings are accepted: they come from the loading/theme
  bootstrap effects that intentionally synchronise with browser storage and fetch state.
