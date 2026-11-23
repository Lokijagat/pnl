import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginInput, Role, SignupInput } from "@pnl/shared";
import { api } from "@/lib/api";

export interface Session {
  user: { id: string; name: string; email: string; role: Role };
  tenant: { id: string; name: string; slug: string; plan: string };
}

const KEY = ["session"];

export function useSession() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        return (await api.get<Session>("/auth/me")).data;
      } catch {
        try {
          return (await api.post<Session>("/auth/refresh")).data;
        } catch {
          return null;
        }
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LoginInput) => (await api.post<Session>("/auth/login", input)).data,
    onSuccess: (s) => qc.setQueryData(KEY, s),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignupInput) => (await api.post<Session>("/auth/signup", input)).data,
    onSuccess: (s) => qc.setQueryData(KEY, s),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.post("/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(KEY, null);
    },
  });
}
