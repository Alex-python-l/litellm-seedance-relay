import { describe, expect, it } from "vitest";

import { validateNewPassword } from "./publicAuthValidation";

describe("validateNewPassword", () => {
  it("accepts a password matching the server policy", () => {
    expect(validateNewPassword("ValidPassword123")).toBeNull();
  });

  it("rejects a password that is long enough but has no upper-case letter or number", () => {
    expect(validateNewPassword("abcdefghijkl")).toBe("密码必须同时包含大写字母、小写字母和数字。");
  });

  it("rejects a short password", () => {
    expect(validateNewPassword("Short1A")).toBe("密码长度必须为 12 至 128 位。");
  });
});
