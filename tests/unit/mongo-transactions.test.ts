import { beforeEach, describe, expect, it, vi } from "vitest";
import { withMongoTransaction } from "@/db/collections";

const mocks = vi.hoisted(() => ({
  getMongoClient: vi.fn(),
  withTransaction: vi.fn(),
  endSession: vi.fn(),
  session: {},
}));

vi.mock("@/db/mongo", () => ({
  getMongoClient: mocks.getMongoClient,
  getMongoDb: vi.fn(),
}));

describe("MongoDB transaction wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMongoClient.mockResolvedValue({
      startSession: () => ({
        withTransaction: mocks.withTransaction,
        endSession: mocks.endSession,
      }),
    });
    mocks.withTransaction.mockImplementation(async (operation: (session: unknown) => Promise<unknown>) => operation(mocks.session));
    mocks.endSession.mockResolvedValue(undefined);
  });

  it("supports transactions whose operation returns void", async () => {
    const operation = vi.fn(async () => undefined);

    await expect(withMongoTransaction(operation)).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("returns the operation value and always ends the session", async () => {
    await expect(withMongoTransaction(async () => "committed")).resolves.toBe("committed");
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("propagates operation failures and closes the session", async () => {
    const failure = new Error("transaction failed");
    mocks.withTransaction.mockRejectedValueOnce(failure);

    await expect(withMongoTransaction(async () => "unused")).rejects.toBe(failure);
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });
});
