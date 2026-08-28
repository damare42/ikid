/**
 * A profile name becomes a filename on disk, so it is the one piece of user
 * input in this app that can turn into a path. These tests pin down that it
 * can't: getDbPath is the single place every database path is built, and
 * anything that would land outside DB_DIR has to be refused there rather than
 * relying on every caller having remembered to sanitise first.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `ik-paths-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, "profiles.json"), JSON.stringify({ active: "ikid", ids: {} }));
fs.writeFileSync(path.join(TMP, "ikid.db"), "");
process.env.IKID_DATA_DIR = TMP;

const { DB_DIR, getDbPath, sanitizeProfileName } = await import("../lib/prisma.js");

describe("sanitizeProfileName", () => {
  it("keeps ordinary names intact, just normalised", () => {
    expect(sanitizeProfileName("Partner")).toBe("partner");
    expect(sanitizeProfileName("  My Business  ")).toBe("my-business");
    expect(sanitizeProfileName("side_hustle-2")).toBe("side_hustle-2");
  });

  it("strips the characters that would make a name into a path", () => {
    expect(sanitizeProfileName("../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeProfileName("a/b")).toBe("ab");
    expect(sanitizeProfileName("..")).toBe("");
    expect(sanitizeProfileName("C:\\windows")).toBe("cwindows");
  });

  it("caps the length so a name can't blow past filesystem limits", () => {
    expect(sanitizeProfileName("x".repeat(200))).toHaveLength(40);
  });
});

describe("getDbPath", () => {
  it("puts an ordinary profile directly in the data directory", () => {
    const p = getDbPath("partner");
    expect(path.dirname(p)).toBe(DB_DIR);
    expect(path.basename(p)).toBe("partner.db");
  });

  it("refuses names that climb out of the data directory", () => {
    for (const name of ["../evil", "../../etc/passwd", "a/../../b"]) {
      expect(() => getDbPath(name), name).toThrow(/Invalid profile name/);
    }
  });

  it("refuses names that are paths rather than filenames", () => {
    // These don't escape — path.join flattens "/etc/passwd" back into DB_DIR —
    // but a profile name is a filename, and treating one as a path is how the
    // escaping cases start.
    for (const name of ["sub/dir", "/etc/passwd", ".", "..", ""]) {
      expect(() => getDbPath(name), JSON.stringify(name)).toThrow(/Invalid profile name/);
    }
  });

  it("still accepts every name sanitizeProfileName can produce", () => {
    // If these two ever disagree, legitimate profiles start failing to open —
    // so this is as much a correctness guard as a security one.
    const candidates = ["partner", "my-business", "side_hustle-2", "a", "x".repeat(40)];
    for (const raw of candidates) {
      const clean = sanitizeProfileName(raw);
      expect(() => getDbPath(clean), clean).not.toThrow();
    }
  });
});
