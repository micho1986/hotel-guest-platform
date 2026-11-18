export type OstroCategory = { id: number; name: string; sort: number };
export type OstroProduct = {
  id: number;
  categoryId: number;
  name: string;
  description: string;
  price: number;
  available: boolean;
  sort: number;
};
export type OstroMenu = { categories: OstroCategory[]; products: OstroProduct[] };

type Value = string | number | null;

/**
 * Reads the Ostro menu file (SQLite `INSERT OR IGNORE` statements) without running it.
 * Only the categories and products tables are read; the settings statement is ignored.
 */
export function parseOstroMenu(sql: string): OstroMenu {
  const categories = readRows(sql, "categories").map((r) => ({
    id: num(r.id),
    name: str(r.name),
    sort: num(r.sort),
  }));
  const products = readRows(sql, "products").map((r) => ({
    id: num(r.id),
    categoryId: num(r.category_id),
    name: str(r.name),
    description: str(r.description),
    price: num(r.price),
    available: num(r.available) === 1,
    sort: num(r.sort),
  }));
  return { categories, products };
}

function readRows(sql: string, table: string): Record<string, Value>[] {
  const head = new RegExp(`INSERT OR IGNORE INTO ${table} \\(([^)]*)\\) VALUES`, "g");
  const rows: Record<string, Value>[] = [];
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql)) !== null) {
    const columns = m[1].split(",").map((c) => c.trim());
    let i = head.lastIndex;
    for (;;) {
      i = skipSeparators(sql, i);
      if (sql[i] === ";") break;
      if (sql[i] !== "(") throw new Error(`Expected "(" in ${table} at offset ${i}`);
      const [values, next] = readTuple(sql, i + 1);
      if (values.length !== columns.length) {
        throw new Error(`${table} row has ${values.length} values, expected ${columns.length}`);
      }
      rows.push(Object.fromEntries(columns.map((c, k) => [c, values[k]])));
      i = next;
    }
  }
  return rows;
}

function skipSeparators(sql: string, from: number): number {
  let i = from;
  while (i < sql.length && /[\s,]/.test(sql[i])) i++;
  return i;
}

/** Reads values up to and including the closing ")". Returns the values and the index after ")". */
function readTuple(sql: string, start: number): [Value[], number] {
  const values: Value[] = [];
  let i = start;
  for (;;) {
    while (/\s/.test(sql[i] ?? "")) i++;
    if (sql[i] === "'") {
      let s = "";
      i++;
      for (;;) {
        if (i >= sql.length) throw new Error("Unterminated string literal in menu file");
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += sql[i++];
      }
      values.push(s);
    } else {
      const token = /^(NULL|-?\d+(?:\.\d+)?)/i.exec(sql.slice(i, i + 40));
      if (!token) throw new Error(`Unexpected value at offset ${i}`);
      values.push(token[1].toUpperCase() === "NULL" ? null : Number(token[1]));
      i += token[1].length;
    }
    while (/\s/.test(sql[i] ?? "")) i++;
    if (sql[i] === ",") {
      i++;
      continue;
    }
    if (sql[i] === ")") return [values, i + 1];
    throw new Error(`Expected "," or ")" at offset ${i}`);
  }
}

function num(v: Value | undefined): number {
  if (typeof v !== "number") throw new Error(`Expected a number, got ${JSON.stringify(v)}`);
  return v;
}

function str(v: Value | undefined): string {
  if (typeof v !== "string") throw new Error(`Expected text, got ${JSON.stringify(v)}`);
  return v;
}
