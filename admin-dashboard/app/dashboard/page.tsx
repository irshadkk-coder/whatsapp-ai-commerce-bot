"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, token } from "../../lib/api";
import { Shell } from "../../components/Shell";
import { useRouter } from "next/navigation";
type Data = { stats: Record<string, number>; recentOrders: any[] };
export default function Dashboard() {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (!token()) return router.push("/login");
    api<Data>("/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [router]);
  const labels: { key: string; label: string }[] = [
    { key: "totalOrders", label: "Total Orders" },
    { key: "todayOrders", label: "Today’s Orders" },
    { key: "pendingOrders", label: "Pending" },
    { key: "confirmedOrders", label: "Confirmed" },
    { key: "codOrders", label: "COD Orders" },
    { key: "onlinePaidOrders", label: "Online Paid" },
    { key: "totalRevenue", label: "Revenue" },
  ];
  return (
    <Shell>
      <h2>Dashboard</h2>
      {error ? (
        <p className="error">{error}</p>
      ) : !data ? (
        <p>Loading dashboard…</p>
      ) : (
        <>
          <section className="grid">
            {labels.map((x) => (
              <div className="card stat" key={x.key}>
                {x.label}
                <b>
                  {x.key === "totalRevenue"
                    ? `₹${data.stats[x.key]}`
                    : data.stats[x.key]}
                </b>
              </div>
            ))}
          </section>
          <h3>Recent orders</h3>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o._id}>
                  <td>{o.orderId}</td>
                  <td>{o.customerName || o.whatsappId}</td>
                  <td>₹{o.totalAmount}</td>
                  <td>
                    {o.paymentMethod} / {o.paymentStatus}
                  </td>
                  <td>{o.orderStatus}</td>
                  <td>
                    <Link href={`/orders/${o._id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Shell>
  );
}
