import type { ReactNode } from "react";
import { Activity, GitPullRequest, Radar, ShieldCheck } from "lucide-react";

const PILLARS = [
  { icon: Radar, title: "Monitoring you can trust", description: "HTTP and TCP checks with response-time and uptime history." },
  { icon: ShieldCheck, title: "Security in one queue", description: "Findings, severity and remediation tracked against every asset." },
  { icon: GitPullRequest, title: "Changes without surprises", description: "Risk assessments, approvals and rollback plans on the record." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-fg lg:flex">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-9 place-items-center rounded-lg bg-accent text-white shadow-sm"
            aria-hidden="true"
          >
            <Activity className="size-5" strokeWidth={2.4} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-[-0.01em]">InfraPilot</span>
            <span className="block text-2xs font-medium uppercase tracking-[0.14em] text-sidebar-muted">
              Infrastructure operations
            </span>
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.02em]">
            The operating picture for the infrastructure you run.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-muted">
            Assets, availability, incidents and change control share one source of truth, so the team reacts to the
            system rather than to a spreadsheet.
          </p>
          <ul className="mt-8 space-y-5">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-sidebar-line bg-sidebar-2 text-sidebar-fg">
                  <pillar.icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-sidebar-fg">{pillar.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-sidebar-muted">{pillar.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-2xs text-sidebar-muted">
          Every metric in this console is computed from your own database. Nothing is sampled or simulated.
        </p>
      </section>

      <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-6 flex items-center gap-2.5 lg:hidden">
          <span
            className="grid size-9 place-items-center rounded-lg bg-accent text-white shadow-sm"
            aria-hidden="true"
          >
            <Activity className="size-5" strokeWidth={2.4} />
          </span>
          <span className="text-base font-semibold tracking-tight text-fg">InfraPilot</span>
        </div>
        <div className="w-full max-w-[420px]">{children}</div>
      </section>
    </main>
  );
}
