import { CategoryManager } from "@/components/category-manager";
import { PageHeader } from "@/components/ui/page";
import { listCategories } from "@/lib/services/categories";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await listCategories(true);
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
