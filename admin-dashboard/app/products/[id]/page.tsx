"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProductForm, ProductInput } from "../../../components/ProductForm";
import { Shell } from "../../../components/Shell";
import { api, token } from "../../../lib/api";
type Product = ProductInput & {
  _id: string;
  createdAt: string;
  updatedAt: string;
};
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product>();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api<{ product: Product }>(`/products/${id}`)
      .then((result) => setProduct(result.product))
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    if (!token()) router.push("/login");
    else load();
  }, [id, router]);
  async function update(value: ProductInput) {
    setSaving(true);
    setMessage("");
    try {
      const { product: updated } = await api<{ product: Product }>(
        `/products/${id}`,
        { method: "PATCH", body: JSON.stringify(value) },
      );
      setProduct(updated);
      setMessage("Product saved.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function deactivate() {
    if (
      !confirm(
        "Deactivate this product? It will no longer be offered for new orders.",
      )
    )
      return;
    setSaving(true);
    setMessage("");
    try {
      const { product: updated } = await api<{ product: Product }>(
        `/products/${id}`,
        { method: "DELETE" },
      );
      setProduct(updated);
      setMessage("Product deactivated.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Shell>
      {!product ? (
        <p>{message || "Loading product…"}</p>
      ) : (
        <>
          <div className="page-title">
            <div>
              <h2>{product.name}</h2>
              <p className="muted">
                Product ID: {product.productId} · Created{" "}
                {new Date(product.createdAt).toLocaleString()}
              </p>
            </div>
            <button
              className="danger"
              disabled={saving || !product.isActive}
              onClick={deactivate}
            >
              Deactivate
            </button>
          </div>
          {message && (
            <p
              className={
                message.includes("saved") || message.includes("deactivated")
                  ? "success"
                  : "error"
              }
            >
              {message}
            </p>
          )}
          <ProductForm
            initial={product}
            submitLabel="Save changes"
            onSubmit={update}
            saving={saving}
          />
        </>
      )}
    </Shell>
  );
}
