import type { User } from "../db/schema.js";

export function handleUsers(id: string): User | null {
  if (!id) return null;
  return { id, email: `${id}@example.com`, createdAt: 0 };
}
