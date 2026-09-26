"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { api, token } from "../../lib/api";
import { useRouter } from "next/navigation";
type Product = {
  _id: string;
  productId: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  cod: boolean;
  isActive: boolean;
};
type Result = {
  products: Product[];
  pagination: { page: number; totalPages: number };
};
export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<Result>();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [stock, setStock] = useState("");
  const [error, setError] = useState("");
  const load = (page = 1) =>
    api<Result>(
      `/products?page=${page}&search=${encodeURIComponent(search)}&status=${status}&stock=${stock}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!token()) router.push("/login");
    else load();
  }, [router]);
  return (
    <Shell>
      <div className="page-title">
        <h2>Products</h2>
        <Link className="primary" href="/products/new">
          Add product
        </Link>
      </div>
      <div className="filters">
        <input
          placeholder="Name, ID, or category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={stock} onChange={(e) => setStock(e.target.value)}>
          <option value="">All stock levels</option>
          <option value="available">In stock</option>
          <option value="out">Out of stock</option>
        </select>
        <button className="primary" onClick={() => load()}>
          Filter
        </button>
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : !data ? (
        <p>Loading products…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>COD</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.products.length ? (
                data.products.map((product) => (
                  <tr key={product._id}>
                    <td>
                      <Link href={`/products/${product._id}`}>
                        {product.name}
                      </Link>
                      <div className="muted">{product.productId}</div>
                    </td>
                    <td>{product.category}</td>
                    <td>₹{product.price}</td>
                    <td>{product.stock}</td>
                    <td>{product.cod ? "Enabled" : "Off"}</td>
                    <td>{product.isActive ? "Active" : "Inactive"}</td>
                    <td>
                      <Link href={`/products/${product._id}`}>View / edit</Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No products found.</td>
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
