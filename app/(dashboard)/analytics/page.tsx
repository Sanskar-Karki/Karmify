"use client";

import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";

export default function AnalyticsPage() {
  const { sales, products, categories, loading } = useResources({
    sales: resources.sales,
    products: resources.products,
    categories: resources.categories,
  });
  return <AnalyticsView sales={sales} products={products} categories={categories} loading={loading} />;
}
