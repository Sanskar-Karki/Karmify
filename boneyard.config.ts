// karmify/boneyard.config.ts

const config = {
  url: "http://localhost:3000",
  outDir: "bones",
  routes: [
    { path: "/dashboard",  name: "dashboard" },
    { path: "/products",   name: "products" },
    { path: "/inventory",  name: "inventory" },
    { path: "/sales",      name: "sales" },
    { path: "/purchases",  name: "purchases" },
    { path: "/customers",  name: "customers" },
    { path: "/settings",   name: "settings" },
  ],
  breakpoints: [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet",  width: 768,  height: 1024 },
  ],
};

export default config;
