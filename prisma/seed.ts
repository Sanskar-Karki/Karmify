import { PrismaClient, Role, MovementType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting database seeding...");

  // 1. Create a Default Admin User (using a placeholder Clerk ID for testing)
  const defaultAdmin = await prisma.user.upsert({
    where: { email: "admin@karmify.com" },
    update: {},
    create: {
      id: "user_admin_placeholder",
      email: "admin@karmify.com",
      name: "Admin User",
      role: Role.ADMIN,
    },
  });
  console.log("✅ Seeded Admin User:", defaultAdmin.name);

  // 2. Create Categories
  const categoryElectronics = await prisma.category.upsert({
    where: { name: "Electronics" },
    update: {},
    create: {
      name: "Electronics",
      description: "Smartphones, Laptops, Accessories, and gadgets",
    },
  });

  const categoryOffice = await prisma.category.upsert({
    where: { name: "Office Supplies" },
    update: {},
    create: {
      name: "Office Supplies",
      description: "Chairs, Desks, Pens, Notebooks, and stationary items",
    },
  });

  const categoryApparel = await prisma.category.upsert({
    where: { name: "Apparel" },
    update: {},
    create: {
      name: "Apparel",
      description: "Corporate hoodies, T-Shirts, and apparel",
    },
  });
  console.log("✅ Seeded Categories: Electronics, Office Supplies, Apparel");

  // 3. Create Suppliers
  const supplierTech = await prisma.supplier.upsert({
    where: { companyName: "TechDistributors Ltd." },
    update: {},
    create: {
      companyName: "TechDistributors Ltd.",
      contactPerson: "Ram Prasad",
      phone: "+977 9851012345",
      email: "contact@techdistributors.com",
      address: "New Road, Kathmandu, Nepal",
      notes: "Primary supplier for computer peripherals and electronics.",
    },
  });

  const supplierFurniture = await prisma.supplier.upsert({
    where: { companyName: "Nepal Office Furniture" },
    update: {},
    create: {
      companyName: "Nepal Office Furniture",
      contactPerson: "Rita Shrestha",
      phone: "+977 9801234567",
      email: "sales@nepalofficefurniture.com",
      address: "Lalitpur, Nepal",
      notes: "Sells highly durable desks and ergonomic office chairs.",
    },
  });
  console.log("✅ Seeded Suppliers:", supplierTech.companyName, ",", supplierFurniture.companyName);

  // 4. Create Warehouses
  const warehouseMain = await prisma.warehouse.upsert({
    where: { name: "Kathmandu Central Depot" },
    update: {},
    create: {
      name: "Kathmandu Central Depot",
      location: "Koteshwor, Kathmandu",
      description: "Main hub for central distribution and storage.",
    },
  });

  const warehouseSub = await prisma.warehouse.upsert({
    where: { name: "Pokhara Branch Outlet" },
    update: {},
    create: {
      name: "Pokhara Branch Outlet",
      location: "Lake Side, Pokhara",
      description: "Branch retail distribution and showroom outlet.",
    },
  });
  console.log("✅ Seeded Warehouses:", warehouseMain.name, ",", warehouseSub.name);

  // 5. Create Products with Initial Stock and Stock Movements
  const productsToSeed = [
    {
      name: "ProBook Laptop 14-inch",
      sku: "PROBOOK-14-001",
      barcode: "8809012345678",
      description: "High-performance business laptop with 16GB RAM, 512GB SSD.",
      brand: "HP",
      costPrice: 850.0,
      sellingPrice: 1150.0,
      minStockLevel: 5,
      categoryId: categoryElectronics.id,
      supplierId: supplierTech.id,
      initialQtyMain: 25,
      initialQtySub: 5,
    },
    {
      name: "Ergonomic Mesh Chair",
      sku: "CHAIR-ERG-002",
      barcode: "8809012345679",
      description: "Fully adjustable lumbar support, high-back mesh office chair.",
      brand: "ErgoSeat",
      costPrice: 120.0,
      sellingPrice: 195.0,
      minStockLevel: 8,
      categoryId: categoryOffice.id,
      supplierId: supplierFurniture.id,
      initialQtyMain: 40,
      initialQtySub: 10,
    },
    {
      name: "Karmify Premium Hoodie",
      sku: "HOODIE-PRM-003",
      barcode: "8809012345680",
      description: "Ultra-soft cotton blend company branded hoodie, size L.",
      brand: "Karmify",
      costPrice: 22.0,
      sellingPrice: 45.0,
      minStockLevel: 15,
      categoryId: categoryApparel.id,
      supplierId: supplierFurniture.id, // Reused for simplicity
      initialQtyMain: 100,
      initialQtySub: 20,
    },
  ];

  for (const prod of productsToSeed) {
    const product = await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {},
      create: {
        name: prod.name,
        sku: prod.sku,
        barcode: prod.barcode,
        description: prod.description,
        brand: prod.brand,
        costPrice: prod.costPrice,
        sellingPrice: prod.sellingPrice,
        minStockLevel: prod.minStockLevel,
        categoryId: prod.categoryId,
        supplierId: prod.supplierId,
      },
    });

    // Allocate stock for Kathmandu Depot
    await prisma.stock.upsert({
      where: {
        productId_warehouseId: {
          productId: product.id,
          warehouseId: warehouseMain.id,
        },
      },
      update: {},
      create: {
        productId: product.id,
        warehouseId: warehouseMain.id,
        quantity: prod.initialQtyMain,
      },
    });

    // Record Stock Movement for Kathmandu Depot
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        quantity: prod.initialQtyMain,
        type: MovementType.STOCK_IN,
        destWhId: warehouseMain.id,
        notes: "Initial balance loading during system seed",
        userId: defaultAdmin.id,
      },
    });

    // Allocate stock for Pokhara Depot
    await prisma.stock.upsert({
      where: {
        productId_warehouseId: {
          productId: product.id,
          warehouseId: warehouseSub.id,
        },
      },
      update: {},
      create: {
        productId: product.id,
        warehouseId: warehouseSub.id,
        quantity: prod.initialQtySub,
      },
    });

    // Record Stock Movement for Pokhara Depot
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        quantity: prod.initialQtySub,
        type: MovementType.STOCK_IN,
        destWhId: warehouseSub.id,
        notes: "Initial balance loading during system seed",
        userId: defaultAdmin.id,
      },
    });

    console.log(`✅ Seeded Product: ${product.name} with stock in main & sub warehouses.`);
  }

  console.log("🎉 Database seeding finished successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
