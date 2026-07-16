import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the data dir at a throwaway folder BEFORE importing the service
// (accountService → prisma.ts resolves DB_DIR at module load).
const TMP = path.join(os.tmpdir(), `ik-acct-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, "profiles.json"), JSON.stringify({ active: "ikid", ids: {} }));
fs.writeFileSync(path.join(TMP, "ikid.db"), "");
fs.writeFileSync(path.join(TMP, "partner.db"), "");
process.env.IKID_DATA_DIR = TMP;

const svc = await import("../services/accountService.js");

beforeEach(() => svc._resetStoreForTests());
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("bootstrap", () => {
  it("adopts existing profiles and makes the active one admin", () => {
    const accounts = svc.listAccounts();
    expect(accounts.map((a) => a.name).sort()).toEqual(["ikid", "partner"]);
    expect(svc.isAdmin("ikid")).toBe(true);
    expect(svc.isAdmin("partner")).toBe(false);
    // exactly one admin
    expect(accounts.filter((a) => a.role === "admin")).toHaveLength(1);
  });

  it("honors IKID_ADMIN override", () => {
    svc._resetStoreForTests();
    process.env.IKID_ADMIN = "partner";
    expect(svc.isAdmin("partner")).toBe(true);
    expect(svc.isAdmin("ikid")).toBe(false);
    delete process.env.IKID_ADMIN;
  });
});

describe("ensureAccount", () => {
  it("adds new profiles as regular users", () => {
    svc.listAccounts(); // trigger bootstrap (ikid admin)
    const a = svc.ensureAccount("newbie");
    expect(a.role).toBe("user");
    expect(a.disabled).toBe(false);
    expect(svc.accountCount()).toBe(3);
  });

  it("is idempotent", () => {
    svc.ensureAccount("newbie");
    const again = svc.ensureAccount("newbie");
    expect(again.role).toBe("user");
    expect(svc.listAccounts().filter((x) => x.name === "newbie")).toHaveLength(1);
  });
});

describe("roles & disabling with last-admin guards", () => {
  it("promotes and demotes", () => {
    svc.setRole("partner", "admin");
    expect(svc.isAdmin("partner")).toBe(true);
    svc.setRole("partner", "user");
    expect(svc.isAdmin("partner")).toBe(false);
  });

  it("refuses to demote the only admin", () => {
    expect(() => svc.setRole("ikid", "user")).toThrow(/last remaining admin/);
    expect(svc.isAdmin("ikid")).toBe(true);
  });

  it("refuses to disable the only admin", () => {
    expect(() => svc.setDisabled("ikid", true)).toThrow(/last remaining admin/);
  });

  it("allows disabling an admin once another admin exists", () => {
    svc.setRole("partner", "admin");
    expect(() => svc.setDisabled("ikid", true)).not.toThrow();
    expect(svc.isDisabled("ikid")).toBe(true);
    // now partner is the last enabled admin
    expect(() => svc.setDisabled("partner", true)).toThrow(/last remaining admin/);
  });

  it("disables and re-enables regular users freely", () => {
    svc.setDisabled("partner", true);
    expect(svc.isDisabled("partner")).toBe(true);
    svc.setDisabled("partner", false);
    expect(svc.isDisabled("partner")).toBe(false);
  });
});

describe("config & rename", () => {
  it("defaults to allowing signups and can toggle", () => {
    expect(svc.getConfig().allowSignups).toBe(true);
    expect(svc.setConfig({ allowSignups: false }).allowSignups).toBe(false);
    expect(svc.getConfig().allowSignups).toBe(false);
  });

  it("moves metadata with a rename", () => {
    svc.listAccounts();
    svc.recordLogin("partner");
    svc.renameAccount("partner", "spouse");
    expect(svc.getAccount("partner")).toBeNull();
    expect(svc.getAccount("spouse")?.lastLogin).not.toBeNull();
  });
});
