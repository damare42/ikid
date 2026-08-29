import type { TransactionDTO } from "../../../shared/types.js";

/** Map a Prisma transaction (with includes) to the wire DTO. */
export function toTransactionDTO(t: any): TransactionDTO {
  return {
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    description: t.description,
    amount: t.amount,
    balance: t.balance,
    type: t.type,
    refNumber: t.refNumber,
    notes: t.notes,
    isTransfer: t.isTransfer,
    cleared: t.cleared ?? false,
    category: t.category
      ? { id: t.category.id, name: t.category.name, type: t.category.type, color: t.category.color }
      : null,
    merchant: t.merchant ? { id: t.merchant.id, name: t.merchant.name } : null,
    account: t.account
      ? { id: t.account.id, name: t.account.name, type: t.account.type, currency: t.account.currency }
      : null,
    tags: (t.tags ?? []).map((tag: any) => ({ id: tag.id, name: tag.name })),
  };
}
