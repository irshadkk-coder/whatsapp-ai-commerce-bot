"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter(); const logout = () => { localStorage.removeItem("adminToken"); router.push("/login"); };
  return <div className="shell"><aside><h1>Store Admin</h1><Link href="/dashboard">Dashboard</Link><Link href="/analytics">Analytics</Link><Link href="/orders">Orders</Link><Link href="/products">Products</Link><Link href="/customers">Customers</Link><Link href="/conversations">Conversations</Link><Link href="/support">Support</Link><button onClick={logout}>Logout</button></aside><main><header><span>Administration</span><button onClick={logout}>Logout</button></header>{children}</main></div>;
}
