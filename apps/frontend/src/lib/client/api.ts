import axios, { isAxiosError, type InternalAxiosRequestConfig } from "axios";
import type { Pagination, SessionPayload } from "@/types/api";

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Shared Axios client. The access token lives in memory only; the refresh token is an httpOnly cookie. */
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "/api/v1",
  timeout: 20000,
  withCredentials: true,
  headers: { "Content-Type": "application/json", "X-InfraPilot-Request": "1" },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let inflight: Promise<SessionPayload | null> | null = null;

/** Single-flight refresh: concurrent 401s share one rotation request. */
export function refreshAccessToken(): Promise<SessionPayload | null> {
  if (!inflight) {
    inflight = api
      .post<{ data: SessionPayload }>("/auth/refresh")
      .then((res) => {
        accessToken = res.data.data.accessToken;
        return res.data.data;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (isAxiosError(error)) {
    const config = error.config as RetryConfig | undefined;
    const url = config?.url ?? "";
    if (error.response?.status === 401 && config && !config._retried && !url.startsWith("/auth/")) {
      config._retried = true;
      const session = await refreshAccessToken();
      if (session) {
        config.headers.set("Authorization", `Bearer ${session.accessToken}`);
        return api.request(config);
      }
    }
  }
  return Promise.reject(error);
});

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isAxiosError(error)) {
    if (!error.response) return "Unable to reach the server. Check your connection and try again.";
    const body = error.response.data as { error?: { message?: string; details?: unknown } } | undefined;
    const details = body?.error?.details;
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as { path?: string; message?: string };
      if (first.message) return first.path ? `${first.path}: ${first.message}` : first.message;
    }
    if (body?.error?.message) return body.error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Validates a payload with the same Zod schema the API uses, so users see errors before a round-trip. */
export function validatePayload(
  schema: {
    safeParse(data: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  payload: unknown,
): void {
  const result = schema.safeParse(payload);
  if (result.success) return;
  const issue = result.error?.issues[0];
  if (!issue) throw new Error("Please check the highlighted fields.");
  const path = issue.path.map(String).join(".");
  throw new Error(path ? `${path}: ${issue.message}` : issue.message);
}

export interface ListResult<T> {
  items: T[];
  meta: Pagination & Record<string, unknown>;
}

function cleanParams(params?: Record<string, unknown>) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

export async function fetchList<T>(url: string, params?: Record<string, unknown>): Promise<ListResult<T>> {
  const res = await api.get<{ data: T[]; meta: Pagination & Record<string, unknown> }>(url, { params: cleanParams(params) });
  return { items: res.data.data, meta: res.data.meta };
}

export async function fetchData<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<{ data: T }>(url, { params: cleanParams(params) });
  return res.data.data;
}

export async function sendData<T = unknown>(method: "post" | "patch" | "delete", url: string, body?: unknown): Promise<T> {
  const res = await api.request<{ data: T }>({ method, url, data: body });
  return res.data.data;
}
