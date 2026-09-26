"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Shell } from "../../components/Shell";
import { api, token } from "../../lib/api";
import { useRouter } from "next/navigation";

type Point = {
  date: string;
  orders?: number;
  revenue?: number;
  customers?: number;
};
type Analytics = {
  range: { from: string; to: string };
  summary: Record<string, number>;
  salesOverTime: Point[];
  customerGrowth: Point[];
  paymentMethods: { method: string; orders: number }[];
  orderStatuses: { status: string; orders: number }[];
  topProducts: {
    productId: string;
    name: string;
    quantity: number;
    orders: number;
    revenue: number;
  }[];
  recentOrders: {
    _id: string;
    orderId: string;
    customerName?: string;
    whatsappId: string;
    productName: string;
    quantity: number;
    totalAmount: number;
    paymentMethod: string;
    paymentStatus: string;
    orderStatus: string;
    createdAt: string;
  }[];
};
const presets = [
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "1y", label: "Last Year" },
];
const inr = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const colours = [
  "#1769e0",
  "#12b76a",
  "#f79009",
  "#9e77ed",
  "#f04438",
  "#6172f3",
];
export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics>();
  const [range, setRange] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load(nextRange = range) {
    setLoading(true);
    setError("");
    try {
      const query =
        nextRange === "custom"
          ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
          : `?range=${nextRange}`;
      setData(await api<Analytics>(`/analytics${query}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!token()) router.push("/login");
    else load("30d");
  }, [router]);
  function selectPreset(key: string) {
    setRange(key);
    load(key);
  }
  const kpis = [
    ["totalRevenue", "Total Revenue", true],
    ["totalOrders", "Total Orders"],
    ["totalCustomers", "Total Customers"],
    ["newCustomers", "New Customers"],
    ["confirmedOrders", "Confirmed Orders"],
    ["pendingOrders", "Pending Orders"],
    ["cancelledOrders", "Cancelled Orders"],
    ["paidOrders", "Paid Orders"],
  ] as const;
  return (
    <Shell>
      <div className="page-title">
        <div>
          <h2>Analytics</h2>
          <p className="muted">Business performance and sales overview</p>
        </div>
        {data && (
          <p className="muted">
            {new Date(data.range.from).toLocaleDateString()} –{" "}
            {new Date(data.range.to).toLocaleDateString()}
          </p>
        )}
      </div>
      <section className="range-picker">
        {presets.map((preset) => (
          <button
            key={preset.key}
            className={range === preset.key ? "primary" : ""}
            onClick={() => selectPreset(preset.key)}
          >
            {preset.label}
          </button>
        ))}
        <button
          className={range === "custom" ? "primary" : ""}
          onClick={() => setRange("custom")}
        >
          Custom
        </button>
        {range === "custom" && (
          <>
            <input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              aria-label="To date"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button
              className="primary"
              disabled={!from || !to}
              onClick={() => load("custom")}
            >
              Apply
            </button>
          </>
        )}
      </section>
      {error ? (
        <p className="error">{error}</p>
      ) : loading || !data ? (
        <section className="grid analytics-loading">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="card" key={index}>
              Loading analytics…
            </div>
          ))}
        </section>
      ) : (
        <>
          <section className="grid">
            {kpis.map(([key, label, currency]) => (
              <div className="card stat" key={key}>
                {label}
                <b>{currency ? inr(data.summary[key]) : data.summary[key]}</b>
              </div>
            ))}
          </section>
          <section className="analytics-charts">
            <div className="card chart-card">
              <h3>Revenue & Orders Over Time</h3>
              {data.salesOverTime.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.salesOverTime}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis
                      yAxisId="revenue"
                      tickFormatter={(value) => inr(value)}
                    />
                    <YAxis
                      yAxisId="orders"
                      orientation="right"
                      allowDecimals={false}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        name === "revenue" ? inr(Number(value)) : value,
                        name === "revenue" ? "Revenue" : "Orders",
                      ]}
                    />
                    <Legend />
                    <Line
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="revenue"
                      stroke="#1769e0"
                    />
                    <Line
                      yAxisId="orders"
                      type="monotone"
                      dataKey="orders"
                      stroke="#12b76a"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">No orders in this period.</p>
              )}
            </div>
            <div className="card chart-card">
              <h3>Customer Growth</h3>
              {data.customerGrowth.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.customerGrowth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="customers"
                      fill="#9e77ed"
                      name="New customers"
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">No new customers in this period.</p>
              )}
            </div>
            <div className="card chart-card">
              <h3>Payment Methods</h3>
              {data.paymentMethods.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={data.paymentMethods}
                      dataKey="orders"
                      nameKey="method"
                      label
                    >
                      {data.paymentMethods.map((entry, index) => (
                        <Cell
                          key={entry.method}
                          fill={colours[index % colours.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">No payment data in this period.</p>
              )}
            </div>
            <div className="card chart-card">
              <h3>Order Status Distribution</h3>
              {data.orderStatuses.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.orderStatuses}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="orders" fill="#f79009" name="Orders" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="muted">No order data in this period.</p>
              )}
            </div>
          </section>
          <h3>Top Selling Products</h3>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.length ? (
                data.topProducts.map((product) => (
                  <tr key={`${product.productId}-${product.name}`}>
                    <td>
                      {product.name}
                      <div className="muted">{product.productId}</div>
                    </td>
                    <td>{product.quantity}</td>
                    <td>{product.orders}</td>
                    <td>{inr(product.revenue)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No successful sales in this period.</td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Recent Orders</h3>
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
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.length ? (
                data.recentOrders.map((order) => (
                  <tr key={order._id}>
                    <td>
                      <Link href={`/orders/${order._id}`}>{order.orderId}</Link>
                    </td>
                    <td>{order.customerName || order.whatsappId}</td>
                    <td>
                      {order.productName} × {order.quantity}
                    </td>
                    <td>{inr(order.totalAmount)}</td>
                    <td>
                      {order.paymentMethod} / {order.paymentStatus}
                    </td>
                    <td>{order.orderStatus}</td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No orders in this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Shell>
  );
}
