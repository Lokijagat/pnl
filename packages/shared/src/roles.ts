export const ROLES = ["owner", "admin", "accountant", "marketer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Kaunsa role kya kar sakta hai */
export const PERMISSIONS = {
  manageIntegrations: ["owner", "admin"],
  manageCosts: ["owner", "admin", "accountant"],
  manageTeam: ["owner", "admin"],
  viewReports: ["owner", "admin", "accountant", "marketer", "viewer"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}
