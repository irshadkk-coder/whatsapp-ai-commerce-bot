"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProductForm, ProductInput } from "../../../components/ProductForm";
import { Shell } from "../../../components/Shell";
import { api } from "../../../lib/api";
export default function NewProductPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function create(value: ProductInput) {
    setSaving(true);
    setError("");
    try {
      await api("/products", { method: "POST", body: JSON.stringify(value) });
      router.push("/products");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Shell>
      <h2>Add product</h2>
      {error && <p className="error">{error}</p>}
      <ProductForm
        submitLabel="Create product"
        onSubmit={create}
        saving={saving}
      />
    </Shell>
  );
}
