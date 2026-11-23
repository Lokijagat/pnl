import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? "") + "/api",
  withCredentials: true,
});

/** Access token (15 min) expire ho to ek baar refresh karke request retry */
let refreshing: Promise<unknown> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = original?.url ?? "";
    if (error.response?.status === 401 && original && !original._retry && !url.startsWith("/auth/")) {
      original._retry = true;
      try {
        refreshing ??= api.post("/auth/refresh").finally(() => (refreshing = null));
        await refreshing;
        return api(original);
      } catch {
        /* fall through */
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Kuch galat ho gaya";
}
