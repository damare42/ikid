/**
 * Password hashing cost parameters + the transparent upgrade path.
 *
 * The danger with strengthening a KDF is locking existing users out. These
 * tests pin the contract: old hashes must keep verifying, new hashes must use
 * the stronger settings, and a correct password must never be rejected because
 * of a parameter change.
 */
import { describe, expect, it } from "vitest";
import { scryptSync } from "node:crypto";
import {
  hashPassword, verifyPassword, needsRehash, SCRYPT_PARAMS, type Credential,
} from "../services/authService.js";

/** A credential exactly as pre-0.6 ikid wrote it: no recorded parameters. */
function legacyCredential(password: string, salt = "0123456789abcdef"): Credential {
  // Node's defaults at the time: N=16384, r=8, p=1.
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

describe("scrypt parameters", () => {
  it("meets OWASP-equivalent cost (N=2^16, r=8, p=2)", () => {
    expect(SCRYPT_PARAMS.N).toBeGreaterThanOrEqual(65536);
    expect(SCRYPT_PARAMS.r).toBeGreaterThanOrEqual(8);
    expect(SCRYPT_PARAMS.p).toBeGreaterThanOrEqual(2);
    // 4x the memory hardness of Node's default — memory is what defeats GPUs.
    expect(128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });

  it("records its parameters with every new hash", () => {
    const c = hashPassword("correct horse battery staple");
    expect(c.N).toBe(SCRYPT_PARAMS.N);
    expect(c.r).toBe(SCRYPT_PARAMS.r);
    expect(c.p).toBe(SCRYPT_PARAMS.p);
    expect(c.salt).toHaveLength(32);
  });

  it("still round-trips and rejects wrong passwords", () => {
    const c = hashPassword("hunter22");
    expect(verifyPassword("hunter22", c)).toBe(true);
    expect(verifyPassword("hunter23", c)).toBe(false);
    expect(verifyPassword("", c)).toBe(false);
  });

  it("uses a unique salt per credential", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("backwards compatibility (nobody gets locked out)", () => {
  it("verifies a legacy hash written before parameters were stored", () => {
    const legacy = legacyCredential("my-old-password");
    expect(legacy.N).toBeUndefined(); // no params recorded, as in 0.5.x
    expect(verifyPassword("my-old-password", legacy)).toBe(true);
    expect(verifyPassword("wrong", legacy)).toBe(false);
  });

  it("flags legacy credentials for upgrade, and current ones as fine", () => {
    expect(needsRehash(legacyCredential("x"))).toBe(true);
    expect(needsRehash(hashPassword("x"))).toBe(false);
  });

  it("an upgraded hash verifies the same password and is stronger", () => {
    const password = "migrate-me";
    const legacy = legacyCredential(password);
    expect(verifyPassword(password, legacy)).toBe(true);

    // What checkLogin does after a successful legacy login:
    const upgraded = hashPassword(password);
    expect(verifyPassword(password, upgraded)).toBe(true);
    expect(needsRehash(upgraded)).toBe(false);
    expect(upgraded.N!).toBeGreaterThan(legacy.N ?? 16384);
  });

  it("never throws on a malformed credential — it just fails the login", () => {
    const broken = { salt: "abc", hash: "not-hex", N: -1, r: 0, p: 0 } as Credential;
    expect(() => verifyPassword("anything", broken)).not.toThrow();
    expect(verifyPassword("anything", broken)).toBe(false);
  });
});
