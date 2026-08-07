export const newPasswordHint = "至少 12 位，并同时包含大写字母、小写字母和数字。";

export function validateNewPassword(password: string): string | null {
  if (password.length < 12 || password.length > 128) {
    return "密码长度必须为 12 至 128 位。";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return "密码必须同时包含大写字母、小写字母和数字。";
  }
  return null;
}
