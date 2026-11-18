import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";

const sql = readFileSync("prisma/data/ostro-menu.sql", "utf8");
const menu = parseOstroMenu(sql);

describe("parseOstroMenu", () => {
  it("reads all 17 categories and 127 products", () => {
    expect(menu.categories).toHaveLength(17);
    expect(menu.products).toHaveLength(127);
  });

  it("unescapes doubled single quotes", () => {
    expect(menu.categories.find((c) => c.id === 4)?.name).toBe("O'Vegan");
  });

  it("reads product 1 exactly", () => {
    expect(menu.products.find((p) => p.id === 1)).toEqual({
      id: 1,
      categoryId: 1,
      name: "Poached Eggs on Toast",
      description: "Poached eggs on rye with avocado, tomato, beetroot labneh and dukkah.",
      price: 59,
      available: true,
      sort: 1,
    });
  });

  it("reads available = 0 as available: false", () => {
    const inline = `INSERT OR IGNORE INTO products (id, category_id, name, description, price, old_price, images, available, sort) VALUES
  (1, 1, 'Sold out pie', '', 10, NULL, '[]', 0, 1);`;
    expect(parseOstroMenu(inline).products[0].available).toBe(false);
  });
});
