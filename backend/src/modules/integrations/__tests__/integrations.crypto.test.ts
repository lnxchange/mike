import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../integrations.crypto";

describe("microsoft token encryption", () => {
  const previous = process.env.USER_API_KEYS_ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = "test-microsoft-secret";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    else process.env.USER_API_KEYS_ENCRYPTION_SECRET = previous;
  });

  it("round-trips a refresh token", () => {
    const sealed = encryptSecret("refresh-token-value");
    expect(sealed.encrypted).not.toContain("refresh-token-value");
    expect(decryptSecret(sealed.encrypted, sealed.iv, sealed.tag)).toBe(
      "refresh-token-value",
    );
  });

  it("returns null for tampered ciphertext", () => {
    const sealed = encryptSecret("refresh-token-value");
    expect(decryptSecret("aaaa", sealed.iv, sealed.tag)).toBeNull();
  });
});
