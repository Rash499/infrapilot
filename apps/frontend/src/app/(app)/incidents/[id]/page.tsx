"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from "@/components/ui";
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

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, user } = useAuth();
  const toast = useToast();
  const incident = useAsync(() => fetchData<Incident>(`/incidents/${id}`), [id]);
  const users = useAsync(() => fetchData<UserOption[]>("/users/options"), []);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm<UpdateValues>({
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

  return (
    <div className="space-y-6">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
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
            title={i.title}
            description={`${i.reference} · Opened ${fmtDateTime(i.openedAt)} by ${i.reporterName ?? "unknown"}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={i.severity} />
                <StatusBadge value={i.priority} />
                <StatusBadge value={i.status} />
              </div>
            }
          />

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-fg">Description</h2>
                <p className="mt-2 whitespace-pre-line text-sm text-fg">{i.description}</p>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-semibold text-fg">Timeline</h2>
                <ol className="mt-4 space-y-4 border-l border-line pl-5">
                  {(i.timeline ?? []).map((t) => (
                    <li key={t.id} className="relative">
                      <span
                        className={`absolute -left-[27px] top-1.5 size-2.5 rounded-full ${t.kind === "system" ? "bg-slate-500" : "bg-sky-500"}`}
                        aria-hidden="true"
                      />
                      <p className={`text-sm ${t.kind === "system" ? "text-muted italic" : "text-fg whitespace-pre-line"}`}>{t.body}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t.kind === "comment" ? t.authorName : "System"} · {fmtDateTime(t.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
                {editable ? (
                  <div className="mt-6 space-y-2 border-t border-line pt-4">
                    <label htmlFor="comment" className="flex items-center gap-2 text-sm font-medium text-fg">
                      <MessageSquare className="size-4" aria-hidden="true" /> Add update
                    </label>
                    <Textarea id="comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share findings, mitigations or next steps." />
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
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-semibold text-fg">Manage incident</h2>
                {editable ? (
                  <form onSubmit={onSave} className="space-y-4" noValidate>
                    {saveError ? (
                      <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
                        {saveError}
                      </p>
                    ) : null}
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
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase text-muted">Root cause</dt>
                      <dd className="text-fg">{i.rootCause || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase text-muted">Resolution</dt>
                      <dd className="text-fg">{i.resolution || "Not recorded"}</dd>
                    </div>
                  </dl>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-fg">Details</h2>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Assignee</dt>
                    <dd className="text-right text-fg">{i.assigneeName ?? "Unassigned"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Last updated</dt>
                    <dd className="text-right text-fg">{fmtRelative(i.updatedAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Resolved</dt>
                    <dd className="text-right text-fg">{fmtDateTime(i.resolvedAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Closed</dt>
                    <dd className="text-right text-fg">{fmtDateTime(i.closedAt)}</dd>
                  </div>
                </dl>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-fg">Affected assets</h2>
                {(i.assets ?? []).length === 0 ? (
                  <EmptyState title="No assets linked" />
                ) : (
                  <ul className="space-y-2">
                    {(i.assets ?? []).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <Link href={`/assets/${a.id}`} className="truncate text-sm text-sky-500 hover:underline">
                          {a.name}
                        </Link>
                        <Badge>{a.assetType.replace(/_/g, " ")}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {user ? <p className="sr-only">Signed in as {user.name}</p> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
