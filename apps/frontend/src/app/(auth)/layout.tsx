import type { ReactNode } from "react";
import { Activity } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-sky-600 text-white" aria-hidden="true">
            <Activity className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-fg">InfraPilot</span>
        </div>
        {children}
      </div>
    </main>
  );
}
