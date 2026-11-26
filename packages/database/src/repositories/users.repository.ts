import type { ClientSession, Filter } from "mongodb";
import { collections, getCollection, newEntityIds } from "@/db/collections";
import type { UserDoc, UserRole } from "@/db/models/documents";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findUserById(id: string, session?: ClientSession): Promise<UserDoc | null> {
  const col = await getCollection<UserDoc>(collections.users);
  return col.findOne({ id }, { session });
}

export async function findUserByEmail(email: string, session?: ClientSession): Promise<UserDoc | null> {
  const col = await getCollection<UserDoc>(collections.users);
  return col.findOne({ email: email.trim().toLowerCase() }, { session });
}

export async function countUsers(session?: ClientSession): Promise<number> {
  const col = await getCollection<UserDoc>(collections.users);
  return col.countDocuments({}, { session });
}

export async function insertUser(
  input: { email: string; name: string; passwordHash: string; role: UserRole },
  session?: ClientSession,
): Promise<UserDoc> {
  const col = await getCollection<UserDoc>(collections.users);
  const now = new Date();
  const doc: UserDoc = {
    ...newEntityIds(),
    email: input.email.trim().toLowerCase(),
    name: input.name,
    passwordHash: input.passwordHash,
    role: input.role,
    isActive: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc, { session });
  return doc;
}

export async function updateUserById(
  id: string,
  patch: Partial<Pick<UserDoc, "name" | "role" | "isActive" | "passwordHash" | "lastLoginAt">>,
  session?: ClientSession,
): Promise<UserDoc | null> {
  const col = await getCollection<UserDoc>(collections.users);
  return col.findOneAndUpdate(
    { id },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after", session },
  );
}

export async function listActiveUserOptions(): Promise<Array<Pick<UserDoc, "id" | "name" | "role">>> {
  const col = await getCollection<UserDoc>(collections.users);
  return col
    .find({ isActive: true }, { projection: { _id: 0, id: 1, name: 1, role: 1 } })
    .sort({ name: 1 })
    .toArray();
}

export async function findUsersByIds(ids: string[]): Promise<Array<Pick<UserDoc, "id" | "name">>> {
  if (ids.length === 0) return [];
  const col = await getCollection<UserDoc>(collections.users);
  return col.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
}

export async function listUsersPaginated(query: {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole;
}): Promise<{ items: UserDoc[]; total: number }> {
  const col = await getCollection<UserDoc>(collections.users);
  const filter: Filter<UserDoc> = {};
  if (query.role) filter.role = query.role;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([
    col.find(filter).sort({ name: 1 }).skip(skip).limit(query.pageSize).toArray(),
    col.countDocuments(filter),
  ]);
  return { items, total };
}
