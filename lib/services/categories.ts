import "server-only";

import { and, asc, eq, isNotNull, max } from "drizzle-orm";

import { accounts, categories } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

function slugify(value: string) {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `category-${crypto.randomUUID().slice(0, 8)}`;
}

export async function listCategories(userId: string, includeArchived = false) {
  const rows = await getDatabase().query.categories.findMany({
    where: eq(categories.userId, userId),
    orderBy: [asc(categories.displayOrder), asc(categories.name)],
  });
  return includeArchived ? rows : rows.filter((row) => !row.isArchived);
}

type CategoryInput = {
  name: string;
  icon: string;
  assetOrLiability: "asset" | "liability";
  description?: string;
  isLiquid: boolean;
  isInvestible: boolean;
};

export function createCategory(userId: string, input: CategoryInput) {
  const db = getDatabase();
  const highest = db
    .select({ value: max(categories.displayOrder) })
    .from(categories)
    .where(eq(categories.userId, userId))
    .get();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  let slug = slugify(input.name);
  const existing = db.query.categories
    .findFirst({ where: and(eq(categories.userId, userId), eq(categories.slug, slug)) })
    .sync();
  if (existing) slug = `${slug}-${id.slice(0, 6)}`;
  db.insert(categories)
    .values({
      id,
      userId,
      ...input,
      slug,
      displayOrder: (highest?.value ?? -1) + 1,
      isArchived: false,
      isSystem: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

export function updateCategory(userId: string, id: string, input: CategoryInput) {
  const db = getDatabase();
  db.transaction((tx) => {
    if (input.assetOrLiability === "liability") {
      const linkedAccount = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.categoryId, id),
            isNotNull(accounts.goalId),
          ),
        )
        .limit(1)
        .get();
      if (linkedAccount) {
        throw new Error(
          "Unlink goals from accounts in this category before making it a liability.",
        );
      }
    }
    const result = tx
      .update(categories)
      .set({ ...input, updatedAt: nowIso() })
      .where(and(eq(categories.userId, userId), eq(categories.id, id)))
      .run();
    if (result.changes === 0) throw new Error("Category not found.");
    tx.update(accounts)
      .set({
        isLiability: input.assetOrLiability === "liability",
        updatedAt: nowIso(),
      })
      .where(and(eq(accounts.userId, userId), eq(accounts.categoryId, id)))
      .run();
  });
}

export function archiveCategory(userId: string, id: string, archived: boolean) {
  const result = getDatabase()
    .update(categories)
    .set({ isArchived: archived, updatedAt: nowIso() })
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .run();
  if (result.changes === 0) throw new Error("Category not found.");
}

export function moveCategory(userId: string, id: string, direction: "up" | "down") {
  const db = getDatabase();
  const rows = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.displayOrder), asc(categories.name))
    .all();
  const index = rows.findIndex((row) => row.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= rows.length) return;
  db.transaction((tx) => {
    tx.update(categories)
      .set({ displayOrder: rows[swapIndex].displayOrder, updatedAt: nowIso() })
      .where(and(eq(categories.userId, userId), eq(categories.id, rows[index].id)))
      .run();
    tx.update(categories)
      .set({ displayOrder: rows[index].displayOrder, updatedAt: nowIso() })
      .where(and(eq(categories.userId, userId), eq(categories.id, rows[swapIndex].id)))
      .run();
  });
}
