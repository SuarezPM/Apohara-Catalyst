export interface LoginInput { email: string; password: string; }
export interface LoginResult { token: string; }

export function handleAuth(input: LoginInput): LoginResult {
  if (!input.email || !input.password) throw new Error("bad credentials");
  return { token: `tok-${input.email}` };
}
