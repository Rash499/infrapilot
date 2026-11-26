"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Activity, ArrowLeft, Check, MessageSquare, Send, ShieldAlert, Siren } from "lucide-react";
import {
  ActivityTimeline,
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DetailItem,
  DetailList,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  cn,
} from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { fetchData, getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { useAsync } from "@/lib/client/use-async";
import { INCIDENT_SEVERITY_OPTIONS, INCIDENT_STATUS_OPTIONS, PRIORITY_OPTIONS, fmtDateTime, fmtRelative } from "@/lib/format";
import { incidentUpdateSchema } from "@/validators/schemas";
import type { Incident, UserOption } from "@/types/api";

interface UpdateValues {
  status: string;
  severity: string;
  priority: string;
  assigneeId: string;
  rootCause: string;
  resolution: string;
}

const LIFECYCLE = ["open", "investigating", "in_progress", "resolved", "closed"] as const;

/** Real status values, rendered as a progress track. No timestamps are invented. */
function LifecycleTrack({ status }: { status: string }) {
  const current = Math.max(0, LIFECYCLE.indexOf(status as (typeof LIFECYCLE)[number]));
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Incident lifecycle">
      {LIFECYCLE.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const label = INCIDENT_STATUS_OPTIONS.find((option) => option.value === step)?.label ?? step;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium",
                active
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : done
                    ? "border-line bg-surface-2 text-fg-secondary"
                    : "border-line bg-surface text-faint",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
              {label}
            </span>
            {index < LIFECYCLE.length - 1 ? <span className="hidden h-px w-3 bg-line sm:block" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can } = useAuth();
  const toast = useToast();
  const incident = useAsync(() => fetchData<Incident>(`/incidents/${id}`), [id]);
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<UpdateValues>({
    defaultValues: { status: "open", severity: "high", priority: "p2", assigneeId: "", rootCause: "", resolution: "" },
  });

  const i = incident.data;
  useEffect(() => {
    if (i) {
      reset({
        status: i.status,
        severity: i.severity,
        priority: i.priority,
        assigneeId: i.assigneeId ?? "",
        rootCause: i.rootCause ?? "",
        resolution: i.resolution ?? "",
      });
    }
  }, [i, reset]);

  const onSave = handleSubmit(async (v) => {
    setSaveError(null);
    const payload = {
      status: v.status,
      severity: v.severity,
      priority: v.priority,
      assigneeId: v.assigneeId || null,
      rootCause: v.rootCause.trim() || null,
      resolution: v.resolution.trim() || null,
    };
    try {
      validatePayload(incidentUpdateSchema, payload);
      await sendData("patch", `/incidents/${id}`, payload);
      toast.success("Incident updated");
      incident.reload();
    } catch (err) {
      setSaveError(getErrorMessage(err));
    }
  });

  const postComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await sendData("post", `/incidents/${id}/comments`, { body: comment.trim() });
      setComment("");
      incident.reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  if (incident.error && !i) return <ErrorState message={incident.error} onRetry={incident.reload} />;

  const editable = can("write");
  const timeline = i?.timeline ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1 rounded text-sm text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to incidents
      </Link>

      {!i ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            eyebrow={i.reference}
            title={i.title}
            description={`Opened ${fmtDateTime(i.openedAt)} by ${i.reporterName ?? "unknown"} · Updated ${fmtRelative(i.updatedAt)}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={i.severity} />
                <StatusBadge value={i.priority} />
                <StatusBadge value={i.status} />
              </div>
            }
          />

          <Card className="px-4 py-3.5">
            <LifecycleTrack status={i.status} />
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <Card>
                <CardHeader title="Description" icon={Siren} />
                <p className="whitespace-pre-line px-4 py-4 text-sm leading-relaxed text-fg">{i.description}</p>
              </Card>

              <Card>
                <CardHeader
                  title="Timeline"
                  description={`${timeline.length} ${timeline.length === 1 ? "entry" : "entries"}`}
                  icon={MessageSquare}
                />
                <div className="px-4 py-4">
                  {timeline.length === 0 ? (
                    <EmptyState title="No updates yet" description="Comments and system events appear here in order." />
                  ) : (
                    <ActivityTimeline
                      items={timeline.map((t) => ({
                        id: t.id,
                        title: <span className={cn(t.kind === "system" && "text-muted")}>{t.body}</span>,
                        meta: fmtRelative(t.createdAt),
                        body: `${t.kind === "comment" ? (t.authorName ?? "Comment") : "System"} · ${fmtDateTime(t.createdAt)}`,
                        tone: t.kind === "system" ? ("neutral" as const) : ("info" as const),
                      }))}
                    />
                  )}
                </div>
                {editable ? (
                  <div className="space-y-2 border-t border-line px-4 py-4">
                    <label htmlFor="comment" className="flex items-center gap-2 text-sm font-medium text-fg">
                      <MessageSquare className="size-4 text-muted" aria-hidden="true" /> Add update
                    </label>
                    <Textarea
                      id="comment"
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share findings, mitigations or next steps."
                    />
                    <div className="flex justify-end">
                      <Button onClick={() => void postComment()} loading={posting} disabled={!comment.trim()}>
                        <Send className="size-4" aria-hidden="true" /> Post update
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Manage incident" description={editable ? "Changes are recorded in the timeline" : "Read-only access"} />
                {editable ? (
                  <form onSubmit={onSave} className="space-y-4 px-4 py-4" noValidate>
                    {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
                    <Field label="Status" htmlFor="u-status">
                      <Select id="u-status" {...register("status")}>
                        {INCIDENT_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Severity" htmlFor="u-sev">
                        <Select id="u-sev" {...register("severity")}>
                          {INCIDENT_SEVERITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Priority" htmlFor="u-pri">
                        <Select id="u-pri" {...register("priority")}>
                          {PRIORITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field label="Assignee" htmlFor="u-assignee">
                      <Select id="u-assignee" {...register("assigneeId")}>
                        <option value="">Unassigned</option>
                        {(users.data ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Root cause" htmlFor="u-root">
                      <Textarea id="u-root" rows={3} {...register("rootCause")} />
                    </Field>
                    <Field label="Resolution summary" htmlFor="u-res" hint="Required before resolving or closing.">
                      <Textarea id="u-res" rows={3} {...register("resolution")} />
                    </Field>
                    <Button type="submit" className="w-full" loading={isSubmitting} disabled={!isDirty}>
                      Save changes
                    </Button>
                  </form>
                ) : (
                  <div className="px-4 py-4">
                    <DetailList className="grid-cols-1">
                      <DetailItem label="Root cause">{i.rootCause || "Not recorded"}</DetailItem>
                      <DetailItem label="Resolution">{i.resolution || "Not recorded"}</DetailItem>
                    </DetailList>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="Details" icon={Activity} />
                <div className="px-4 py-4">
                  <DetailList className="grid-cols-1 gap-y-3">
                    <DetailItem label="Assignee">{i.assigneeName ?? "Unassigned"}</DetailItem>
                    <DetailItem label="Last updated">{fmtRelative(i.updatedAt)}</DetailItem>
                    <DetailItem label="Resolved">{fmtDateTime(i.resolvedAt)}</DetailItem>
                    <DetailItem label="Closed">{fmtDateTime(i.closedAt)}</DetailItem>
                  </DetailList>
                </div>
              </Card>

              <Card>
                <CardHeader title="Affected assets" icon={ShieldAlert} />
                {(i.assets ?? []).length === 0 ? (
                  <EmptyState title="No assets linked" />
                ) : (
                  <ul className="divide-y divide-line">
                    {(i.assets ?? []).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                        <Link href={`/assets/${a.id}`} className="truncate rounded text-sm text-accent hover:underline">
                          {a.name}
                        </Link>
                        <Badge>{a.assetType.replace(/_/g, " ")}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
