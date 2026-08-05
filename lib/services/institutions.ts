import "server-only";

import { and, asc, count, eq, getTableColumns, isNull, ne } from "drizzle-orm";

import { accounts, institutions, type InstitutionType } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { normalizeInstitutionName } from "@/lib/institutions";

export type InstitutionInput = {
  name: string;
  type: InstitutionType;
  websiteUrl?: string;
  countryCode?: string;
  address?: string;
  notes?: string;
};

export async function listInstitutions(
  userId: string,
  options: { includeArchived?: boolean } = {},
) {
  return getDatabase()
    .select({
      ...getTableColumns(institutions),
      accountCount: count(accounts.id),
    })
    .from(institutions)
    .leftJoin(
      accounts,
      and(
        eq(institutions.userId, accounts.userId),
        eq(institutions.id, accounts.institutionId),
      ),
    )
    .where(
      options.includeArchived
        ? eq(institutions.userId, userId)
        : and(eq(institutions.userId, userId), isNull(institutions.archivedAt)),
    )
    .groupBy(institutions.id)
    .orderBy(asc(institutions.name));
}

export async function getInstitution(userId: string, id: string) {
  return getDatabase().query.institutions.findFirst({
    where: and(eq(institutions.userId, userId), eq(institutions.id, id)),
  });
}

export function createInstitution(userId: string, input: InstitutionInput) {
  const db = getDatabase();
  const normalizedName = normalizeInstitutionName(input.name);
  const duplicate = db.query.institutions
    .findFirst({
      where: and(
        eq(institutions.userId, userId),
        eq(institutions.normalizedName, normalizedName),
      ),
    })
    .sync();
  if (duplicate)
    throw new Error("An institution with this name already exists.");

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.insert(institutions)
    .values({
      id,
      userId,
      name: input.name,
      normalizedName,
      type: input.type,
      websiteUrl: input.websiteUrl || null,
      countryCode: input.countryCode || null,
      address: input.address || null,
      notes: input.notes || null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

export function updateInstitution(
  userId: string,
  id: string,
  input: InstitutionInput,
) {
  const db = getDatabase();
  const normalizedName = normalizeInstitutionName(input.name);
  const duplicate = db.query.institutions
    .findFirst({
      where: and(
        eq(institutions.userId, userId),
        eq(institutions.normalizedName, normalizedName),
        ne(institutions.id, id),
      ),
    })
    .sync();
  if (duplicate)
    throw new Error("An institution with this name already exists.");

  const result = db
    .update(institutions)
    .set({
      name: input.name,
      normalizedName,
      type: input.type,
      websiteUrl: input.websiteUrl || null,
      countryCode: input.countryCode || null,
      address: input.address || null,
      notes: input.notes || null,
      updatedAt: nowIso(),
    })
    .where(and(eq(institutions.userId, userId), eq(institutions.id, id)))
    .run();
  if (result.changes === 0) throw new Error("Institution not found.");
}

export function setInstitutionArchived(
  userId: string,
  id: string,
  archived: boolean,
) {
  const timestamp = nowIso();
  const result = getDatabase()
    .update(institutions)
    .set({ archivedAt: archived ? timestamp : null, updatedAt: timestamp })
    .where(and(eq(institutions.userId, userId), eq(institutions.id, id)))
    .run();
  if (result.changes === 0) throw new Error("Institution not found.");
}
