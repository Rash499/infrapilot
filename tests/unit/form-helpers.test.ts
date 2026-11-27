import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  collectFieldErrors,
  passwordChecks,
  serverFieldErrors,
  validateFields,
} from "@/lib/client/form";
import { monitorCreateSchema } from "@/validators/schemas";

const schema = z.object({
  name: z.string().min(3, "Name is too short"),
  port: z.string().refine((value) => Number(value) <= 65535, "Port must be 65535 or lower"),
});

describe("collectFieldErrors", () => {
  it("keeps the first message per field and reports success", () => {
    expect(collectFieldErrors(schema, { name: "abc", port: "1" }).ok).toBe(true);

    const result = collectFieldErrors(schema, { name: "a", port: "70000" });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({ name: "Name is too short", port: "Port must be 65535 or lower" });
  });
});

describe("validateFields", () => {
  it("routes every issue to its react-hook-form field", () => {
    const setError = vi.fn();
    const result = validateFields(schema, { name: "a", port: "70000" }, setError, ["name", "port"]);

    expect(result.valid).toBe(false);
    expect(setError).toHaveBeenCalledWith("name", { type: "validation", message: "Name is too short" });
    expect(setError).toHaveBeenCalledWith("port", { type: "validation", message: "Port must be 65535 or lower" });
    // Field-level messages are not repeated in the banner.
    expect(result.formError).toBeUndefined();
  });

  it("promotes issues for unknown fields to a form-level message", () => {
    const setError = vi.fn();
    const result = validateFields(schema, { name: "a", port: "1" }, setError, ["port"]);

    expect(result.valid).toBe(false);
    expect(setError).not.toHaveBeenCalled();
    expect(result.formError).toBe("name: Name is too short");
  });

  it("returns the object-level message when the schema only reports a form issue", () => {
    const objectSchema = z
      .object({ start: z.string(), end: z.string() })
      .refine((value) => value.end > value.start, "End must be after start");
    const result = validateFields(objectSchema, { start: "b", end: "a" }, vi.fn(), ["start", "end"]);

    expect(result.valid).toBe(false);
    expect(result.formError).toBe("End must be after start");
  });

  it("accepts a valid payload without touching the form state", () => {
    const setError = vi.fn();
    const result = validateFields(schema, { name: "ok-name", port: "443" }, setError, ["name", "port"]);

    expect(result).toEqual({ valid: true });
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("serverFieldErrors", () => {
  const fields = ["url", "port"] as const;

  it("maps API validation details back onto the matching inputs", () => {
    const setError = vi.fn();
    const error = {
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: { message: "Validation failed", details: [{ path: "url", message: "URL is required" }] } },
      },
    };

    const result = serverFieldErrors(error, setError, [...fields]);
    expect(result.firstField).toBe("url");
    expect(result.unmatched).toEqual([]);
    expect(setError).toHaveBeenCalledWith("url", { type: "validation", message: "URL is required" });
  });

  it("returns nothing for errors that are not validation responses", () => {
    const setError = vi.fn();
    expect(serverFieldErrors(new Error("network"), setError, [...fields])).toEqual({ unmatched: [] });
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("passwordChecks", () => {
  it("mirrors the shared password schema", () => {
    const weak = passwordChecks("short");
    expect(weak.filter((check) => check.met).map((check) => check.id)).toEqual(["lower", "max"]);

    const strong = passwordChecks("Correct-Horse-9");
    expect(strong.every((check) => check.met)).toBe(true);
  });
});

describe("shared monitor schema", () => {
  it("rejects a TCP check without a port and accepts a complete HTTP check", () => {
    const tcp = monitorCreateSchema.safeParse({ name: "db", monitorType: "tcp", host: "db.example.com" });
    expect(tcp.success).toBe(false);
    expect(tcp.error?.issues.map((issue) => issue.path.join("."))).toContain("port");

    const http = monitorCreateSchema.safeParse({
      name: "api",
      monitorType: "http",
      url: "https://status.example.com/health",
      intervalSeconds: 60,
      timeoutMs: 5000,
    });
    expect(http.success).toBe(true);
  });
});
