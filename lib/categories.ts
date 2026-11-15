// Karmalu Originals sells clothing, so these are the categories a store starts
// with. Each has the words that point to it in a product name, used to sort
// existing products and anything the website adds.

export const CLOTHING_CATEGORIES = [
  { name: "Trousers", description: "Trousers, pants and joggers", words: ["trouser", "pant", "jogger", "cargo", "chino"] },
  { name: "Jackets", description: "Jackets, coats and cardigans", words: ["jacket", "coat", "blazer", "cardigan", "puffer", "bomber"] },
  { name: "Hoodies", description: "Hoodies and sweatshirts", words: ["hoodie", "hoody", "sweatshirt", "sweat shirt", "pullover"] },
  { name: "Denim", description: "Jeans and denim", words: ["denim", "jean"] },
  { name: "T-shirts", description: "T-shirts and tops", words: ["t-shirt", "tshirt", "t shirt", "tee", "polo", "top"] },
] as const;

/** The clothing category a product name points to, or null when nothing matches. */
export function guessClothingCategory(productName: string): string | null {
  const name = ` ${productName.toLowerCase().replace(/[^a-z0-9-]+/g, " ")} `;
  // Whole words, singular or plural: "tee" must not match "teen".
  const has = (word: string) => name.includes(` ${word} `) || name.includes(` ${word}s `) || name.includes(` ${word}es `);
  // Denim before Jackets: "Denim Jacket" belongs with the denim.
  const order = ["Denim", "Hoodies", "Jackets", "Trousers", "T-shirts"];
  for (const categoryName of order) {
    const category = CLOTHING_CATEGORIES.find(c => c.name === categoryName)!;
    if (category.words.some(has)) return category.name;
  }
  return null;
}
