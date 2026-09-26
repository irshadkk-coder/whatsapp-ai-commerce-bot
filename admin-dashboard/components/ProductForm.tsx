"use client";

import { FormEvent, useEffect, useState } from "react";

export type ProductInput = {
  productId?: string;
  name: string;
  category: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  cod: boolean;
  isActive: boolean;
};
const empty: ProductInput = {
  productId: "",
  name: "",
  category: "",
  description: "",
  image: "",
  price: 0,
  stock: 0,
  cod: false,
  isActive: true,
};

export function ProductForm({
  initial,
  submitLabel,
  onSubmit,
  saving,
}: {
  initial?: Partial<ProductInput>;
  submitLabel: string;
  onSubmit: (value: ProductInput) => Promise<void>;
  saving?: boolean;
}) {
  const [value, setValue] = useState<ProductInput>({ ...empty, ...initial });
  useEffect(() => setValue({ ...empty, ...initial }), [initial]);
  const set = (key: keyof ProductInput, next: string | number | boolean) =>
    setValue((current) => ({ ...current, [key]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(value);
  }
  return (
    <form className="product-form card" onSubmit={submit}>
      {initial?.productId === undefined && (
        <label>
          Product ID
          <input
            required
            maxLength={80}
            value={value.productId}
            onChange={(e) => set("productId", e.target.value)}
            placeholder="e.g. P006"
          />
        </label>
      )}
      <label>
        Name
        <input
          required
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <label>
        Category
        <input
          required
          value={value.category}
          onChange={(e) => set("category", e.target.value)}
        />
      </label>
      <label>
        Price (₹)
        <input
          required
          min="0.01"
          step="0.01"
          type="number"
          value={value.price}
          onChange={(e) => set("price", Number(e.target.value))}
        />
      </label>
      <label>
        Stock
        <input
          required
          min="0"
          step="1"
          type="number"
          value={value.stock}
          onChange={(e) => set("stock", Number(e.target.value))}
        />
      </label>
      <label>
        Image URL or local path
        <input
          value={value.image}
          onChange={(e) => set("image", e.target.value)}
          placeholder="https://… or /images/product.jpg"
        />
      </label>
      <label className="wide">
        Description
        <textarea
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          rows={4}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value.cod}
          onChange={(e) => set("cod", e.target.checked)}
        />{" "}
        Cash on Delivery available
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />{" "}
        Product is active
      </label>
      <div className="wide">
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
