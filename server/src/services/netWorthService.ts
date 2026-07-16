/**
 * Net worth: assets and liabilities tracked as snapshot histories.
 * Snapshot values are always positive; liabilities subtract in totals.
 * History carries each asset's last known value forward month to month.
 */
import { prisma } from "../lib/prisma.js";
import { loanPayoff } from "./finmath.js";
import type { AssetDTO, AssetKind, NetWorthPoint, NetWorthSummary } from "../../../shared/types.js";

const LIABILITY_KINDS = new Set(["mortgage", "loan", "credit"]);
export const isLiabilityKind = (kind: string) => LIABILITY_KINDS.has(kind);

const DEFAULT_ICONS: Record<string, string> = {
  cash: "💵", investment: "📈", property: "🏠", vehicle: "🚗", other: "💰",
  mortgage: "🏦", loan: "📄", credit: "💳",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function toDTO(a: any): AssetDTO {
  const snaps = a.snapshots as { date: Date; value: number }[]; // sorted desc
  const latest = snaps[0];
  const previous = snaps[1];
  let payoff: AssetDTO["payoff"] = null;
  if (a.isLiability && a.ratePct != null && a.monthlyPayment != null && latest?.value > 0) {
    const p = loanPayoff(latest.value, a.ratePct, a.monthlyPayment);
    if (p.ok) payoff = { months: p.months, payoffDate: p.payoffDate, totalInterest: p.totalInterest };
  }
  return {
    id: a.id,
    name: a.name,
    kind: a.kind as AssetKind,
    isLiability: a.isLiability,
    icon: a.icon,
    units: a.units,
    unitPrice: a.unitPrice,
    ratePct: a.ratePct,
    monthlyPayment: a.monthlyPayment,
    notes: a.notes,
    value: r2(latest?.value ?? 0),
    updatedAt: (latest?.date ?? a.createdAt).toISOString().slice(0, 10),
    previousValue: previous ? r2(previous.value) : null,
    payoff,
  };
}

export async function listAssets(): Promise<AssetDTO[]> {
  const assets = await prisma.asset.findMany({
    include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
    orderBy: [{ isLiability: "asc" }, { name: "asc" }],
  });
  return assets.map(toDTO);
}

export async function summary(): Promise<NetWorthSummary> {
  const assets = await listAssets();
  const totalAssets = r2(assets.filter((a) => !a.isLiability).reduce((s, a) => s + a.value, 0));
  const totalLiabilities = r2(assets.filter((a) => a.isLiability).reduce((s, a) => s + a.value, 0));
  const byKindMap = new Map<string, { kind: string; total: number; isLiability: boolean }>();
  for (const a of assets) {
    const e = byKindMap.get(a.kind) ?? { kind: a.kind, total: 0, isLiability: a.isLiability };
    e.total = r2(e.total + a.value);
    byKindMap.set(a.kind, e);
  }
  return {
    netWorth: r2(totalAssets - totalLiabilities),
    totalAssets,
    totalLiabilities,
    assets,
    byKind: [...byKindMap.values()].sort((a, b) => b.total - a.total),
  };
}

/** Monthly net worth series with carry-forward of each asset's last value. */
export async function history(months = 24): Promise<NetWorthPoint[]> {
  const assets = await prisma.asset.findMany({
    include: { snapshots: { orderBy: { date: "asc" } } },
  });
  if (assets.length === 0) return [];

  const firstSnap = assets
    .flatMap((a) => a.snapshots)
    .reduce<Date | null>((min, s) => (min === null || s.date < min ? s.date : min), null);
  if (!firstSnap) return [];

  const now = new Date();
  const start = new Date(
    Math.max(
      new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime(),
      new Date(firstSnap.getFullYear(), firstSnap.getMonth(), 1).getTime(),
    ),
  );

  const points: NetWorthPoint[] = [];
  for (let d = new Date(start); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    let assetsTotal = 0;
    let liabTotal = 0;
    for (const a of assets) {
      // last snapshot at or before month end (snapshots sorted asc)
      let value: number | null = null;
      for (const s of a.snapshots) {
        if (s.date <= monthEnd) value = s.value;
        else break;
      }
      if (value === null) continue; // asset didn't exist yet
      if (a.isLiability) liabTotal += value;
      else assetsTotal += value;
    }
    points.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      assets: r2(assetsTotal),
      liabilities: r2(liabTotal),
      netWorth: r2(assetsTotal - liabTotal),
    });
  }
  return points;
}

export interface CreateAssetInput {
  name: string;
  kind: string;
  value: number;
  icon?: string;
  units?: number | null;
  unitPrice?: number | null;
  ratePct?: number | null;
  monthlyPayment?: number | null;
  notes?: string | null;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetDTO> {
  const asset = await prisma.asset.create({
    data: {
      name: input.name,
      kind: input.kind,
      isLiability: isLiabilityKind(input.kind),
      icon: input.icon || DEFAULT_ICONS[input.kind] || "💰",
      units: input.units ?? null,
      unitPrice: input.unitPrice ?? null,
      ratePct: input.ratePct ?? null,
      monthlyPayment: input.monthlyPayment ?? null,
      notes: input.notes ?? null,
      snapshots: { create: { value: Math.abs(input.value) } },
    },
    include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
  });
  return toDTO(asset);
}

export async function updateAsset(
  id: number,
  patch: Partial<Omit<CreateAssetInput, "value">>,
): Promise<AssetDTO> {
  const data: any = { ...patch };
  if (patch.kind) data.isLiability = isLiabilityKind(patch.kind);
  const asset = await prisma.asset.update({
    where: { id },
    data,
    include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
  });
  return toDTO(asset);
}

/** Record a new value (optionally back-dated). Same-day snapshots replace. */
export async function addSnapshot(assetId: number, value: number, date?: string): Promise<AssetDTO> {
  const when = date ? new Date(date + "T12:00:00") : new Date();
  const dayStart = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const dayEnd = new Date(when.getFullYear(), when.getMonth(), when.getDate(), 23, 59, 59);
  await prisma.assetSnapshot.deleteMany({ where: { assetId, date: { gte: dayStart, lte: dayEnd } } });
  await prisma.assetSnapshot.create({ data: { assetId, value: Math.abs(value), date: when } });
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
  });
  return toDTO(asset);
}

export async function deleteAsset(id: number): Promise<void> {
  await prisma.asset.delete({ where: { id } });
}

export async function assetHistory(id: number) {
  const snaps = await prisma.assetSnapshot.findMany({
    where: { assetId: id },
    orderBy: { date: "asc" },
  });
  return snaps.map((s) => ({ date: s.date.toISOString().slice(0, 10), value: r2(s.value) }));
}
