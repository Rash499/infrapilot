import { describe, expect, it } from "vitest";
import { requireRole, type AuthUser } from "@/lib/auth";
import { PERMISSIONS, PERMISSION_LEVELS, type Role } from "@/lib/permissions";

describe("role permission matrix", () => {
  it("matches the roles accepted by the server authorization guard", () => {
    const roles: Role[] = ["admin", "operator", "viewer"];

    for (const role of roles) {
      const user: AuthUser = { id: "user-1", email: "user@example.com", name: "Test User", role };
      for (const level of PERMISSION_LEVELS) {
        const allowed = PERMISSIONS[level].some((allowedRole) => allowedRole === role);
        if (allowed) {
          expect(() => requireRole(user, PERMISSIONS[level])).not.toThrow();
        } else {
          expect(() => requireRole(user, PERMISSIONS[level])).toThrow();
        }
      }
    }
  });
});
