// karmify/lib/mockData.ts

export interface Category {
  id: string;
  name: string;
  description: string;
}

export interface Supplier {
  id: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  description: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  description: string;
  brand: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  imageUrl?: string;
  expiryDate?: string;
  status: "active" | "inactive";
}

export interface Stock {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  quantity: number;
  type: "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT" | "TRANSFER";
  sourceWhId?: string;
  destWhId?: string;
  referenceId?: string;
  notes?: string;
  userId?: string;
  createdAt: string;
}

export interface PurchaseItem {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  warehouseId: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  items: PurchaseItem[];
  totalAmount: number;
  notes?: string;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  warehouseId: string;
  items: SaleItem[];
  taxAmount: number;
  discount: number;
  totalAmount: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  details: string;
  userId?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error";
  isRead: boolean;
  createdAt: string;
}

// Default seed data matching seed.ts
const SEED_CATEGORIES: Category[] = [
  { id: "cat-electronics", name: "Electronics", description: "Smartphones, Laptops, Accessories, and gadgets" },
  { id: "cat-office", name: "Office Supplies", description: "Chairs, Desks, Pens, Notebooks, and stationary items" },
  { id: "cat-apparel", name: "Apparel", description: "Corporate hoodies, T-Shirts, and apparel" }
];

const SEED_SUPPLIERS: Supplier[] = [
  {
    id: "sup-tech",
    companyName: "TechDistributors Ltd.",
    contactPerson: "Ram Prasad",
    phone: "+977 9851012345",
    email: "contact@techdistributors.com",
    address: "New Road, Kathmandu, Nepal",
    notes: "Primary supplier for computer peripherals and electronics."
  },
  {
    id: "sup-furniture",
    companyName: "Nepal Office Furniture",
    contactPerson: "Rita Shrestha",
    phone: "+977 9801234567",
    email: "sales@nepalofficefurniture.com",
    address: "Lalitpur, Nepal",
    notes: "Sells highly durable desks and ergonomic office chairs."
  }
];

const SEED_WAREHOUSES: Warehouse[] = [
  { id: "wh-main", name: "Kathmandu Central Depot", location: "Koteshwor, Kathmandu", description: "Main hub for central distribution and storage." },
  { id: "wh-sub", name: "Pokhara Branch Outlet", location: "Lake Side, Pokhara", description: "Branch retail distribution and showroom outlet." }
];

const SEED_PRODUCTS: Product[] = [
  {
    id: "prod-1",
    name: "ProBook Laptop 14-inch",
    sku: "PROBOOK-14-001",
    barcode: "8809012345678",
    description: "High-performance business laptop with 16GB RAM, 512GB SSD.",
    brand: "HP",
    categoryId: "cat-electronics",
    supplierId: "sup-tech",
    costPrice: 850.0,
    sellingPrice: 1150.0,
    minStockLevel: 5,
    status: "active"
  },
  {
    id: "prod-2",
    name: "Ergonomic Mesh Chair",
    sku: "CHAIR-ERG-002",
    barcode: "8809012345679",
    description: "Fully adjustable lumbar support, high-back mesh office chair.",
    brand: "ErgoSeat",
    categoryId: "cat-office",
    supplierId: "sup-furniture",
    costPrice: 120.0,
    sellingPrice: 195.0,
    minStockLevel: 8,
    status: "active"
  },
  {
    id: "prod-3",
    name: "Karmify Premium Hoodie",
    sku: "HOODIE-PRM-003",
    barcode: "8809012345680",
    description: "Ultra-soft cotton blend company branded hoodie, size L.",
    brand: "Karmify",
    categoryId: "cat-apparel",
    supplierId: "sup-furniture",
    costPrice: 22.0,
    sellingPrice: 45.0,
    minStockLevel: 15,
    status: "active"
  }
];

const SEED_STOCKS: Stock[] = [
  { id: "st-1-main", productId: "prod-1", warehouseId: "wh-main", quantity: 25 },
  { id: "st-1-sub", productId: "prod-1", warehouseId: "wh-sub", quantity: 5 },
  { id: "st-2-main", productId: "prod-2", warehouseId: "wh-main", quantity: 40 },
  { id: "st-2-sub", productId: "prod-2", warehouseId: "wh-sub", quantity: 10 },
  { id: "st-3-main", productId: "prod-3", warehouseId: "wh-main", quantity: 100 },
  { id: "st-3-sub", productId: "prod-3", warehouseId: "wh-sub", quantity: 20 }
];

const SEED_MOVEMENTS: StockMovement[] = [
  { id: "m-1", productId: "prod-1", quantity: 25, type: "STOCK_IN", destWhId: "wh-main", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m-2", productId: "prod-1", quantity: 5, type: "STOCK_IN", destWhId: "wh-sub", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m-3", productId: "prod-2", quantity: 40, type: "STOCK_IN", destWhId: "wh-main", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m-4", productId: "prod-2", quantity: 10, type: "STOCK_IN", destWhId: "wh-sub", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m-5", productId: "prod-3", quantity: 100, type: "STOCK_IN", destWhId: "wh-main", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m-6", productId: "prod-3", quantity: 20, type: "STOCK_IN", destWhId: "wh-sub", notes: "Initial balance loading during system seed", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() }
];

const SEED_SALES: Sale[] = [
  {
    id: "sale-1",
    invoiceNumber: "INV-2026-001",
    customerName: "Kshitiz Adhikari",
    customerEmail: "kshitiz@example.com",
    customerPhone: "+977 9841234567",
    warehouseId: "wh-main",
    items: [
      { id: "si-1", productId: "prod-3", quantity: 5, unitPrice: 45.0 },
      { id: "si-2", productId: "prod-2", quantity: 1, unitPrice: 195.0 }
    ],
    taxAmount: 54.6, // 13% VAT on subtotal 420 (225 + 195)
    discount: 20.0,
    totalAmount: 454.6, // (420 - 20) + 54.6
    paymentStatus: "PAID",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "sale-2",
    invoiceNumber: "INV-2026-002",
    customerName: "Prerna Thapa",
    customerEmail: "prerna@example.com",
    customerPhone: "+977 9811002233",
    warehouseId: "wh-sub",
    items: [
      { id: "si-3", productId: "prod-1", quantity: 1, unitPrice: 1150.0 }
    ],
    taxAmount: 149.5, // 13% VAT on 1150
    discount: 50.0,
    totalAmount: 1249.5, // (1150 - 50) + 149.5
    paymentStatus: "PAID",
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  }
];

const SEED_PURCHASES: PurchaseOrder[] = [
  {
    id: "po-1",
    orderNumber: "PO-2026-001",
    supplierId: "sup-tech",
    warehouseId: "wh-main",
    status: "COMPLETED",
    paymentStatus: "PAID",
    items: [
      { id: "pi-1", productId: "prod-1", quantity: 10, unitCost: 850.0 }
    ],
    totalAmount: 8500.0,
    notes: "Restock for central storage, fast moving SKU",
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "po-2",
    orderNumber: "PO-2026-002",
    supplierId: "sup-furniture",
    warehouseId: "wh-sub",
    status: "PENDING",
    paymentStatus: "UNPAID",
    items: [
      { id: "pi-2", productId: "prod-2", quantity: 5, unitCost: 120.0 }
    ],
    totalAmount: 600.0,
    notes: "Showroom floor layout upgrades",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const SEED_NOTIFICATIONS: Notification[] = [
  { id: "n-1", title: "Low Stock Alert", message: "HP ProBook Laptop 14-inch stock is low at Pokhara (5 left)", type: "warning", isRead: false, createdAt: new Date().toISOString() },
  { id: "n-2", title: "Stock Received", message: "Successfully received 10x ProBook Laptop 14-inch in PO-2026-001", type: "info", isRead: true, createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }
];

const SEED_ACTIVITIES: ActivityLog[] = [
  { id: "a-1", action: "User Login", details: "Sanskar Karki logged in from Kathmandu Central", createdAt: new Date().toISOString() },
  { id: "a-2", action: "POS Sale Created", details: "Invoice INV-2026-002 completed by cashier", createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() }
];

// Helper to check environment
const isBrowser = typeof window !== "undefined";

function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  if (!isBrowser) return defaultValue;
  const item = localStorage.getItem(key);
  if (!item) {
    localStorage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(item);
  } catch (e) {
    return defaultValue;
  }
}

function setLocalStorageItem<T>(key: string, value: T): void {
  if (isBrowser) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

// Initializer
export function initializeMockData(): void {
  if (!isBrowser) return;
  
  if (!localStorage.getItem("karmify_initialized")) {
    localStorage.setItem("karmify_categories", JSON.stringify(SEED_CATEGORIES));
    localStorage.setItem("karmify_suppliers", JSON.stringify(SEED_SUPPLIERS));
    localStorage.setItem("karmify_warehouses", JSON.stringify(SEED_WAREHOUSES));
    localStorage.setItem("karmify_products", JSON.stringify(SEED_PRODUCTS));
    localStorage.setItem("karmify_stocks", JSON.stringify(SEED_STOCKS));
    localStorage.setItem("karmify_movements", JSON.stringify(SEED_MOVEMENTS));
    localStorage.setItem("karmify_sales", JSON.stringify(SEED_SALES));
    localStorage.setItem("karmify_purchases", JSON.stringify(SEED_PURCHASES));
    localStorage.setItem("karmify_notifications", JSON.stringify(SEED_NOTIFICATIONS));
    localStorage.setItem("karmify_activities", JSON.stringify(SEED_ACTIVITIES));
    localStorage.setItem("karmify_initialized", "true");
  }
}

// Getters and Setters
export function getCategories(): Category[] { return getLocalStorageItem("karmify_categories", SEED_CATEGORIES); }
export function saveCategories(data: Category[]): void { setLocalStorageItem("karmify_categories", data); }

export function getSuppliers(): Supplier[] { return getLocalStorageItem("karmify_suppliers", SEED_SUPPLIERS); }
export function saveSuppliers(data: Supplier[]): void { setLocalStorageItem("karmify_suppliers", data); }

export function getWarehouses(): Warehouse[] { return getLocalStorageItem("karmify_warehouses", SEED_WAREHOUSES); }
export function saveWarehouses(data: Warehouse[]): void { setLocalStorageItem("karmify_warehouses", data); }

export function getProducts(): Product[] { return getLocalStorageItem("karmify_products", SEED_PRODUCTS); }
export function saveProducts(data: Product[]): void { setLocalStorageItem("karmify_products", data); }

export function getStocks(): Stock[] { return getLocalStorageItem("karmify_stocks", SEED_STOCKS); }
export function saveStocks(data: Stock[]): void { setLocalStorageItem("karmify_stocks", data); }

export function getStockMovements(): StockMovement[] { return getLocalStorageItem("karmify_movements", SEED_MOVEMENTS); }
export function saveStockMovements(data: StockMovement[]): void { setLocalStorageItem("karmify_movements", data); }

export function getSales(): Sale[] { return getLocalStorageItem("karmify_sales", SEED_SALES); }
export function saveSales(data: Sale[]): void { setLocalStorageItem("karmify_sales", data); }

export function getPurchaseOrders(): PurchaseOrder[] { return getLocalStorageItem("karmify_purchases", SEED_PURCHASES); }
export function savePurchaseOrders(data: PurchaseOrder[]): void { setLocalStorageItem("karmify_purchases", data); }

export function getNotifications(): Notification[] { return getLocalStorageItem("karmify_notifications", SEED_NOTIFICATIONS); }
export function saveNotifications(data: Notification[]): void { setLocalStorageItem("karmify_notifications", data); }

export function getActivityLogs(): ActivityLog[] { return getLocalStorageItem("karmify_activities", SEED_ACTIVITIES); }
export function saveActivityLogs(data: ActivityLog[]): void { setLocalStorageItem("karmify_activities", data); }

// Log Helpers
export function addActivity(action: string, details: string): void {
  const logs = getActivityLogs();
  const newLog: ActivityLog = {
    id: `a-${Date.now()}`,
    action,
    details,
    createdAt: new Date().toISOString()
  };
  saveActivityLogs([newLog, ...logs]);
}

export function addNotification(title: string, message: string, type: "info" | "warning" | "error"): void {
  const notifications = getNotifications();
  const newNotif: Notification = {
    id: `n-${Date.now()}`,
    title,
    message,
    type,
    isRead: false,
    createdAt: new Date().toISOString()
  };
  saveNotifications([newNotif, ...notifications]);
}
