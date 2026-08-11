"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import {
  createBeneficiary,
  createEstatePlanSnapshot,
  deleteEstateAllocation,
  deleteEstatePlanSnapshot,
  deleteResiduaryAllocation,
  EstatePlanningError,
  setBeneficiaryArchived,
  updateBeneficiary,
  updateEstatePlan,
  upsertEstateAllocation,
  upsertEstateDirective,
  upsertResiduaryAllocation,
} from "@/lib/services/estate-planning";
import {
  beneficiarySchema,
  estateAllocationSchema,
  estateDirectiveSchema,
  estatePlanSchema,
  formDataObject,
  type ActionState,
  zodActionError,
} from "@/lib/validation";

export type EstateActionState = ActionState & { snapshotId?: string };

function refreshEstate() {
  revalidatePath("/estate");
  revalidatePath("/accounts");
}

function estateMutationError(error: unknown): ActionState {
  if (error instanceof EstatePlanningError) return { message: error.message };
  console.error(
    "Estate planning mutation failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return { message: "The estate planning change could not be saved." };
}

export async function createBeneficiaryAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = beneficiarySchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    createBeneficiary(userId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Beneficiary added." };
}

export async function updateBeneficiaryAction(
  beneficiaryId: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = beneficiarySchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateBeneficiary(userId, beneficiaryId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Beneficiary updated." };
}

export async function archiveBeneficiaryAction(
  beneficiaryId: string,
  archived: boolean,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    setBeneficiaryArchived(userId, beneficiaryId, archived);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return {
    ok: true,
    message: archived ? "Beneficiary archived." : "Beneficiary restored.",
  };
}

export async function updateEstatePlanAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = estatePlanSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateEstatePlan(userId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Estate plan details updated." };
}

export async function upsertEstateDirectiveAction(
  accountId: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const values = formDataObject(formData);
  const parsed = estateDirectiveSchema.safeParse({
    ...values,
    isIncluded: formData.get("isIncluded") === "on",
  });
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    upsertEstateDirective(userId, accountId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Asset directive saved." };
}

export async function upsertEstateAllocationAction(
  directiveId: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = estateAllocationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    upsertEstateAllocation(userId, directiveId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Asset allocation saved." };
}

export async function deleteEstateAllocationAction(
  allocationId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    deleteEstateAllocation(userId, allocationId);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Asset allocation removed." };
}

export async function upsertResiduaryAllocationAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = estateAllocationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    upsertResiduaryAllocation(userId, parsed.data);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Residual allocation saved." };
}

export async function deleteResiduaryAllocationAction(
  allocationId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    deleteResiduaryAllocation(userId, allocationId);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Residual allocation removed." };
}

export async function createEstateSnapshotAction(): Promise<EstateActionState> {
  const { userId } = await requireSession();
  try {
    const snapshotId = createEstatePlanSnapshot(userId);
    refreshEstate();
    return {
      ok: true,
      message: "Estate Planning Summary created.",
      snapshotId,
    };
  } catch (error) {
    return estateMutationError(error);
  }
}

export async function deleteEstateSnapshotAction(
  snapshotId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    deleteEstatePlanSnapshot(userId, snapshotId);
  } catch (error) {
    return estateMutationError(error);
  }
  refreshEstate();
  return { ok: true, message: "Estate summary deleted." };
}