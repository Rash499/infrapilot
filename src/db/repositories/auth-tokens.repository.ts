import type { ClientSession } from "mongodb";
import { collections, getCollection, newEntityIds, withMongoTransaction } from "@/db/collections";
import type { PasswordResetTokenDoc, RefreshTokenDoc } from "@/db/models/documents";

export interface NewRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export async function insertRefreshToken(
  input: NewRefreshTokenInput,
  session?: ClientSession,
): Promise<RefreshTokenDoc> {
  const col = await getCollection<RefreshTokenDoc>(collections.refreshTokens);
  const doc: RefreshTokenDoc = {
    ...newEntityIds(),
    userId: input.userId,
    tokenHash: input.tokenHash,
    familyId: input.familyId,
    expiresAt: input.expiresAt,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    revokedAt: null,
    replacedById: null,
    createdAt: new Date(),
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function findRefreshTokenByHash(
  tokenHash: string,
  session?: ClientSession,
): Promise<RefreshTokenDoc | null> {
  const col = await getCollection<RefreshTokenDoc>(collections.refreshTokens);
  return col.findOne({ tokenHash }, { session });
}

export async function revokeRefreshTokenFamily(familyId: string, session?: ClientSession): Promise<void> {
  const col = await getCollection<RefreshTokenDoc>(collections.refreshTokens);
  await col.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
}

export async function revokeActiveRefreshTokensForUser(userId: string, session?: ClientSession): Promise<void> {
  const col = await getCollection<RefreshTokenDoc>(collections.refreshTokens);
  await col.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { session },
  );
}

export async function rotateRefreshTokenDoc(
  currentId: string,
  nextInput: NewRefreshTokenInput,
): Promise<RefreshTokenDoc> {
  return withMongoTransaction(async (session) => {
    const col = await getCollection<RefreshTokenDoc>(collections.refreshTokens);
    const nextDoc: RefreshTokenDoc = {
      ...newEntityIds(),
      userId: nextInput.userId,
      tokenHash: nextInput.tokenHash,
      familyId: nextInput.familyId,
      expiresAt: nextInput.expiresAt,
      userAgent: nextInput.userAgent,
      ipAddress: nextInput.ipAddress,
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(),
    };
    await col.insertOne(nextDoc, { session });
    const claimed = await col.updateOne(
      { id: currentId, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedById: nextDoc.id } },
      { session },
    );
    if (claimed.matchedCount === 0) {
      throw new Error("Refresh token was already revoked");
    }
    return nextDoc;
  });
}

export async function insertPasswordResetToken(
  input: { userId: string; tokenHash: string; expiresAt: Date },
  session?: ClientSession,
): Promise<PasswordResetTokenDoc> {
  const col = await getCollection<PasswordResetTokenDoc>(collections.passwordResetTokens);
  const doc: PasswordResetTokenDoc = {
    ...newEntityIds(),
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    usedAt: null,
    createdAt: new Date(),
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function consumePasswordResetToken(tokenHash: string): Promise<PasswordResetTokenDoc | null> {
  const col = await getCollection<PasswordResetTokenDoc>(collections.passwordResetTokens);
  const now = new Date();
  return col.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  );
}
