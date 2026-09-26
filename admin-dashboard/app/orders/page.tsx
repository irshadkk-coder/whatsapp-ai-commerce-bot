"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, token } from "../../lib/api";
import { Shell } from "../../components/Shell";
import { useRouter } from "next/navigation";
export default function Orders() {
  const [data, setData] = useState<any>();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const load = (page = 1) =>
    api<any>(
      `/orders?page=${page}&search=${encodeURIComponent(search)}&status=${status}&paymentStatus=${paymentStatus}&paymentMethod=${paymentMethod}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!token()) router.push("/login");
    else load();
  }, [router]);
  return (
    <Shell>
      <h2>Orders</h2>
      <div className="filters">
        <input
          placeholder="Order, customer, mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[
            "PENDING",
            "CONFIRMED",
            "PROCESSING",
            "SHIPPED",
            "DELIVERED",
            "CANCELLED",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          value={paymentStatus}
          onChange={(e) => setPaymentStatus(e.target.value)}
        >
          <option value="">All payment statuses</option>
          {["PENDING", "COD", "PAID", "FAILED", "REFUNDED"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          <option value="">All methods</option>
          <option>COD</option>
          <option>ONLINE</option>
        </select>
        <button className="primary" onClick={() => load()}>
          Filter
        </button>
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : !data ? (
        <p>Loading orders…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.orders.length ? (
                data.orders.map((o: any) => (
                  <tr key={o._id}>
                    <td>{o.orderId}</td>
                    <td>{o.customerName || o.whatsappId}</td>
                    <td>{o.productName}</td>
                    <td>₹{o.totalAmount}</td>
                    <td>
                      {o.paymentMethod} / {o.paymentStatus}
                    </td>
                    <td>{o.orderStatus}</td>
                    <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/orders/${o._id}`}>View</Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
          <p>
            <button
              disabled={data.pagination.page <= 1}
              onClick={() => load(data.pagination.page - 1)}
            >
              Previous
            </button>{" "}
            Page {data.pagination.page} of {data.pagination.totalPages || 1}{" "}
            <button
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => load(data.pagination.page + 1)}
            >
              Next
            </button>
          </p>
        </>
      )}
    </Shell>
  );
}
