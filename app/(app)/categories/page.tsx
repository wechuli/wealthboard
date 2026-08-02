import { CategoryManager } from "@/components/category-manager";
import { PageHeader } from "@/components/ui/page";
import { listCategories } from "@/lib/services/categories";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const { userId } = await requireSession();
  const categories = await listCategories(userId, true);
  return (
    <>
      <PageHeader
        title="Categories"
        description="Organize holdings, control allocation reporting, and classify liquid or investible assets."
      />
      <CategoryManager categories={categories} />
    </>
  );
}
