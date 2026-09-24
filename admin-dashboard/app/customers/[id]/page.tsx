"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Shell } from "../../../components/Shell";
import { api, token } from "../../../lib/api";
type Order = { _id: string; orderId: string; productName: string; quantity: number; totalAmount: number; paymentMethod: string; paymentStatus: string; orderStatus: string; createdAt: string };
type Data = { customer: { name?: string; whatsappId: string; phone?: string; createdAt: string; updatedAt: string; orderCount: number; totalPaid: number; conversation?: { id: string; status: string; currentStep: string } | null }; orders: Order[] };
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const [data, setData] = useState<Data>(); const [error, setError] = useState("");
  useEffect(() => { if (!token()) router.push("/login"); else api<Data>(`/customers/${id}`).then(setData).catch((e) => setError(e.message)); }, [id, router]);
  return <Shell>{error ? <p className="error">{error}</p> : !data ? <p>Loading customer…</p> : <><h2>{data.customer.name || "Customer"}</h2><section className="grid"><div className="card"><h3>Contact</h3><p>{data.customer.whatsappId || data.customer.phone}</p><p className="muted">Joined {new Date(data.customer.createdAt).toLocaleString()}</p><p className="muted">Last active {new Date(data.customer.updatedAt).toLocaleString()}</p></div><div className="card"><h3>Order summary</h3><p>{data.customer.orderCount} total orders</p><p>₹{data.customer.totalPaid} paid online</p></div><div className="card"><h3>Conversation</h3>{data.customer.conversation ? <><p>{data.customer.conversation.status}</p><p className="muted">{data.customer.conversation.currentStep}</p><Link href={`/conversations/${data.customer.conversation.id}`}>View conversation</Link></> : <p className="muted">No conversation found.</p>}</div></section><h3>Order history</h3><table><thead><tr><th>Order</th><th>Product</th><th>Amount</th><th>Payment</th><th>Status</th><th>Date</th></tr></thead><tbody>{data.orders.length ? data.orders.map((order) => <tr key={order._id}><td><Link href={`/orders/${order._id}`}>{order.orderId}</Link></td><td>{order.productName} × {order.quantity}</td><td>₹{order.totalAmount}</td><td>{order.paymentMethod} / {order.paymentStatus}</td><td>{order.orderStatus}</td><td>{new Date(order.createdAt).toLocaleString()}</td></tr>) : <tr><td colSpan={6}>No orders found.</td></tr>}</tbody></table></>}</Shell>;
}
