export type Role = "admin" | "operator" | "viewer";

/** Minimum access levels enforced by authorize() on the server. */
export const PERMISSIONS = {
  read: ["admin", "operator", "viewer"],
  write: ["admin", "operator"],
  admin: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export const PERMISSION_LEVELS = ["read", "write", "admin"] as const;
