import { describe, expect, it } from "vitest";
import {
  hashPassword, verifyPassword, createSession, getSessionProfile, destroySession,
  parseCookies, sessionCookie,
} from "../services/authService.js";

describe("password hashing", () => {
  it("round-trips and uses unique salts", () => {
    const a = hashPassword("hunter22");
    const b = hashPassword("hunter22");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword("hunter22", a)).toBe(true);
    expect(verifyPassword("hunter22", b)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const cred = hashPassword("correct-horse");
    expect(verifyPassword("wrong-horse", cred)).toBe(false);
    expect(verifyPassword("", cred)).toBe(false);
  });

  it("is deterministic for a fixed salt", () => {
    const a = hashPassword("pw", "aabbccdd");
    const b = hashPassword("pw", "aabbccdd");
    expect(a.hash).toBe(b.hash);
  });
});

describe("sessions", () => {
  it("creates, resolves, and destroys sessions", () => {
    const token = createSession("dawit");
    expect(token).toHaveLength(64);
    expect(getSessionProfile(token)).toBe("dawit");
    destroySession(token);
    expect(getSessionProfile(token)).toBeNull();
  });

  it("returns null for unknown or missing tokens", () => {
    expect(getSessionProfile("nope")).toBeNull();
    expect(getSessionProfile(undefined)).toBeNull();
  });
});

describe("cookies", () => {
  it("parses cookie headers", () => {
    expect(parseCookies("a=1; ikid_session=abc; b=2")).toMatchObject({ ikid_session: "abc" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("session cookie is HttpOnly and SameSite=Strict", () => {
    const c = sessionCookie("tok123");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("tok123");
  });
});
