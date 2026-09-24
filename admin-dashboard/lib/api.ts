const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
export const token = () => typeof window === "undefined" ? null : localStorage.getItem("adminToken");
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}/api/admin${path}`, { ...options, headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}
