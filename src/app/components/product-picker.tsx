'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Select } from './ui/fields';

/** Switches the product a screen shows, through the ?product= parameter. */
export function ProductPicker({
  products,
  value,
}: {
  products: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (products.length < 2) return null;
  return (
    <Select
      aria-label="Product"
      className="h-8 w-auto"
      value={value}
      onChange={(event) => {
        router.push(`${pathname}?product=${encodeURIComponent(event.target.value)}`);
      }}
    >
      {products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.name}
        </option>
      ))}
    </Select>
  );
}
