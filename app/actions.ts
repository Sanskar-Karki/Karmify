// Barrel for the app's server actions, kept so existing imports of
// "@/app/actions" continue to work. The implementations live in lib/actions/*,
// split by domain, and every one of them is scoped to the caller's store
// (tenant) via lib/tenant.ts.

export * from "@/lib/actions/core";
export * from "@/lib/actions/catalog";
export * from "@/lib/actions/inventory";
export * from "@/lib/actions/sales";
export * from "@/lib/actions/purchases";
export * from "@/lib/actions/websiteSync";
