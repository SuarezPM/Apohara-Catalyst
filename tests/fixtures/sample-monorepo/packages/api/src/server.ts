// Minimal HTTP server (no Express dep — uses Bun.serve so no install needed).
import { handleAuth } from "./routes/auth.js";
import { handleUsers } from "./routes/users.js";

export function buildServer() {
  return {
    routes: {
      "POST /auth/login": handleAuth,
      "GET /users/:id": handleUsers,
    },
  };
}
