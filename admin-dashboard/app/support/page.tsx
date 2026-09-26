"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { api, token } from "../../lib/api";
import { useRouter } from "next/navigation";
type Stats = {
  totalConversations: number;
  humanRequired: number;
  botActive: number;
  resolved: number;
};
type Conversation = {
  _id: string;
  whatsappId: string;
  status: string;
  currentStep: string;
  updatedAt: string;
  customer?: { name?: string };
  lastMessage?: { message: string; direction: string; createdAt: string };
  latestOrder?: {
    orderId: string;
    productName: string;
    totalAmount: number;
    orderStatus: string;
  };
};
type List = {
  conversations: Conversation[];
  pagination: { page: number; totalPages: number };
};
const filters = [
  { key: "", label: "All" },
  { key: "HUMAN_REQUIRED", label: "Human Required" },
  { key: "BOT_ACTIVE", label: "Bot Active" },
  { key: "RESOLVED", label: "Resolved" },
];
export default function SupportPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>();
  const [data, setData] = useState<List>();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const load = (page = 1) =>
    api<List>(
      `/support/conversations?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  const loadStats = () =>
    api<{ stats: Stats }>("/support/stats")
      .then((result) => setStats(result.stats))
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!token()) router.push("/login");
    else {
      load();
      loadStats();
    }
  }, [router]);
  function chooseStatus(next: string) {
    setStatus(next);
    api<List>(
      `/support/conversations?page=1&search=${encodeURIComponent(search)}&status=${next}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  }
  return (
    <Shell>
      <div className="page-title">
        <div>
          <h2>Support</h2>
          <p className="muted">Human handoff and conversation workspace</p>
        </div>
      </div>
      {stats ? (
        <section className="grid">
          <div className="card stat">
            Total Conversations<b>{stats.totalConversations}</b>
          </div>
          <div className="card stat attention">
            Human Required<b>{stats.humanRequired}</b>
          </div>
          <div className="card stat">
            Bot Active<b>{stats.botActive}</b>
          </div>
          <div className="card stat">
            Resolved<b>{stats.resolved}</b>
          </div>
        </section>
      ) : (
        <p>Loading support statistics…</p>
      )}
      <div className="filters">
        <input
          placeholder="Customer, WhatsApp, or order ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="primary" onClick={() => load()}>
          Search
        </button>
      </div>
      <div className="support-filters">
        {filters.map((filter) => (
          <button
            key={filter.key}
            className={status === filter.key ? "primary" : ""}
            onClick={() => chooseStatus(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : !data ? (
        <p>Loading conversations…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Last message</th>
                <th>Status</th>
                <th>Order context</th>
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.conversations.length ? (
                data.conversations.map((item) => (
                  <tr
                    key={item._id}
                    className={
                      item.status === "HUMAN_REQUIRED" ? "human-row" : ""
                    }
                  >
                    <td>
                      {item.customer?.name || "Unnamed customer"}
                      <div className="muted">{item.whatsappId}</div>
                    </td>
                    <td>
                      {item.lastMessage ? (
                        <>
                          <span>{item.lastMessage.message.slice(0, 80)}</span>
                          <div className="muted">
                            {item.lastMessage.direction}
                          </div>
                        </>
                      ) : (
                        "No messages"
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          item.status === "HUMAN_REQUIRED" ? "handoff" : ""
                        }
                      >
                        {item.status === "HUMAN_REQUIRED"
                          ? "👤 HUMAN REQUIRED"
                          : item.status}
                      </span>
                      <div className="muted">{item.currentStep}</div>
                    </td>
                    <td>
                      {item.latestOrder ? (
                        <>
                          {item.latestOrder.orderId}
                          <div className="muted">
                            {item.latestOrder.productName} · ₹
                            {item.latestOrder.totalAmount}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{new Date(item.updatedAt).toLocaleString()}</td>
                    <td>
                      <Link href={`/support/${item._id}`}>Open</Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No support conversations found.</td>
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
