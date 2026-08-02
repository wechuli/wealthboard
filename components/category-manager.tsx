"use client";

import { useRef, useState, useTransition } from "react";
import { Archive, ArrowDown, ArrowUp, LoaderCircle, Plus, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  archiveCategoryAction,
  createCategoryAction,
  moveCategoryAction,
  updateCategoryAction,
} from "@/app/(app)/actions";
import { CATEGORY_ICON_OPTIONS, CategoryIcon } from "@/components/category-icon";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Label, Select } from "@/components/ui/form-controls";
import type { Category } from "@/db/schema";
import type { ActionState } from "@/lib/validation";

function CategoryEditor({
  category,
  action,
}: {
  category?: Category;
  action: (formData: FormData) => Promise<ActionState>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  return (
    <form
      ref={formRef}
      className="grid items-end gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await action(new FormData(formRef.current!));
          setMessage(result.message);
          if (result.ok) {
            toast.success(result.message);
            if (!category) formRef.current?.reset();
          } else if (result.message) toast.error(result.message);
        });
      }}
    >
      <div>
        <Label htmlFor={`name-${category?.id || "new"}`}>Name</Label>
        <Input id={`name-${category?.id || "new"}`} name="name" defaultValue={category?.name} required />
      </div>
      <div>
        <Label htmlFor={`icon-${category?.id || "new"}`}>Icon</Label>
        <Select id={`icon-${category?.id || "new"}`} name="icon" defaultValue={category?.icon || "CircleDollarSign"}>
          {CATEGORY_ICON_OPTIONS.map((icon) => <option key={icon}>{icon}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`kind-${category?.id || "new"}`}>Classification</Label>
        <Select id={`kind-${category?.id || "new"}`} name="assetOrLiability" defaultValue={category?.assetOrLiability || "asset"}>
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
        </Select>
      </div>
      <Checkbox name="isLiquid" label="Liquid" defaultChecked={category?.isLiquid} />
      <Checkbox name="isInvestible" label="Investible" defaultChecked={category?.isInvestible ?? true} />
      <Button size="sm" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" size={15} /> : category ? <Save size={15} /> : <Plus size={15} />}
        {category ? "Save" : "Add"}
      </Button>
      <input type="hidden" name="description" value={category?.description || ""} />
      {message ? <span className="sr-only" role="status">{message}</span> : null}
    </form>
  );
}

export function CategoryManager({ categories }: { categories: Category[] }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Create custom category</h2>
        <CategoryEditor action={createCategoryAction} />
      </Card>
      <div className="space-y-3">
        {categories.map((category, index) => (
          <Card key={category.id} className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-white/[0.05] p-2 text-slate-300"><CategoryIcon name={category.icon} size={18} /></span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{category.name}</h2>
                    {category.isSystem ? <Badge>Built in</Badge> : null}
                    {category.isArchived ? <Badge tone="warning">Archived</Badge> : null}
                  </div>
                  <p className="text-xs text-slate-500">{category.assetOrLiability === "asset" ? "Asset" : "Liability"} · order {index + 1}</p>
                </div>
              </div>
              <div className="flex">
                <MutationButton action={moveCategoryAction.bind(null, category.id, "up")} variant="ghost" size="icon" aria-label="Move category up"><ArrowUp size={15} /></MutationButton>
                <MutationButton action={moveCategoryAction.bind(null, category.id, "down")} variant="ghost" size="icon" aria-label="Move category down"><ArrowDown size={15} /></MutationButton>
                <MutationButton
                  action={archiveCategoryAction.bind(null, category.id, !category.isArchived)}
                  confirm={category.isArchived ? undefined : "Archive this category? Existing accounts will retain it."}
                  successMessage={category.isArchived ? "Category restored." : "Category archived."}
                  variant="ghost"
                  size="icon"
                  aria-label={category.isArchived ? "Restore category" : "Archive category"}
                >{category.isArchived ? <RotateCcw size={15} /> : <Archive size={15} />}</MutationButton>
              </div>
            </div>
            <CategoryEditor category={category} action={updateCategoryAction.bind(null, category.id)} />
          </Card>
        ))}
      </div>
    </div>
  );
}
