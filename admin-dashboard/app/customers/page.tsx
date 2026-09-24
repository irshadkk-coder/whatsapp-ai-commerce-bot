"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { api, token } from "../../lib/api";
import { useRouter } from "next/navigation";
type Customer = { _id: string; name?: string; whatsappId: string; phone?: string; orderCount: number; totalPaid: number; latestOrder?: string; updatedAt: string };
type Result = { customers: Customer[]; pagination: { page: number; totalPages: number } };
export default function CustomersPage() {
  const router = useRouter(); const [data, setData] = useState<Result>(); const [search, setSearch] = useState(""); const [error, setError] = useState("");
  const load = (page = 1) => api<Result>(`/customers?page=${page}&search=${encodeURIComponent(search)}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { if (!token()) router.push("/login"); else load(); }, [router]);
  return <Shell><h2>Customers</h2><div className="filters"><input placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} /><button className="primary" onClick={() => load()}>Search</button></div>{error ? <p className="error">{error}</p> : !data ? <p>Loading customers…</p> : <><table><thead><tr><th>Customer</th><th>WhatsApp</th><th>Orders</th><th>Total paid</th><th>Last order</th><th>Last active</th><th /></tr></thead><tbody>{data.customers.length ? data.customers.map((customer) => <tr key={customer._id}><td>{customer.name || "Unnamed customer"}</td><td>{customer.whatsappId || customer.phone}</td><td>{customer.orderCount}</td><td>₹{customer.totalPaid}</td><td>{customer.latestOrder || "—"}</td><td>{new Date(customer.updatedAt).toLocaleString()}</td><td><Link href={`/customers/${customer._id}`}>View</Link></td></tr>) : <tr><td colSpan={7}>No customers found.</td></tr>}</tbody></table><p><button disabled={data.pagination.page <= 1} onClick={() => load(data.pagination.page - 1)}>Previous</button> Page {data.pagination.page} of {data.pagination.totalPages || 1} <button disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => load(data.pagination.page + 1)}>Next</button></p></>}</Shell>;
}
