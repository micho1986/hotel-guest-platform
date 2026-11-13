/**
 * End-to-end walkthrough in a real browser: a brand-new hotel is set up through
 * the screens only (M1 "done when"). Needs the app running and the database up.
 *
 *   pnpm build && pnpm start -p 3010 &
 *   BASE_URL=http://localhost:3010 pnpm test:e2e
 *
 * Uses the locally installed Chrome (CHROME_PATH to override).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright-core";
import { totpAt } from "../../src/server/auth/totp";

const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const slug = `e2e-${Date.now()}`;
const ADMIN_EMAIL = "admin@e2e.test";
const ADMIN_PASSWORD = "Walkthrough-Pass-1";
const STAFF_EMAIL = "attendant@e2e.test";
const STAFF_PASSWORD = "Attendant-Pass-2";

let step = 0;
function check(condition: unknown, what: string) {
  if (!condition) throw new Error(`FAILED: ${what}`);
  console.log(`  ✓ ${++step}. ${what}`);
}
const code = (secret: string) => totpAt(secret, Date.now() / 1000);

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/en/staff/login`);
  await page.fill("#hotelCode", slug);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button:has-text("Sign in")');
}
async function choosePassword(page: Page, current: string, next: string) {
  await page.waitForURL("**/staff/password");
  await page.fill("#currentPassword", current);
  await page.fill("#newPassword", next);
  await page.fill("#confirmPassword", next);
  await page.click('button:has-text("Save password")');
}

async function main() {
  const out = execFileSync(
    "pnpm",
    ["-s", "platform:create-hotel", "--name", "E2E Walkthrough Hotel", "--slug", slug, "--admin-name", "Elena Admin", "--admin-email", ADMIN_EMAIL],
    { encoding: "utf8" },
  );
  const tempPassword = /Temporary password:\s+(\S+)/.exec(out)?.[1];
  check(tempPassword, "platform script created the hotel and printed a temporary password");

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  try {
    await page.goto(`${BASE}/en/staff/settings`);
    await page.waitForURL("**/staff/login");
    check(true, "settings without signing in redirects to the sign-in page");

    await signIn(page, ADMIN_EMAIL, "definitely-wrong-1");
    await page.waitForSelector("text=Those details don't match");
    check(true, "a wrong password shows an error and stays on sign-in");

    await signIn(page, ADMIN_EMAIL, tempPassword!);
    await choosePassword(page, tempPassword!, ADMIN_PASSWORD);
    await page.waitForURL("**/staff/mfa");
    check(true, "temporary password forces a password change, then 2-step setup");

    await page.goto(`${BASE}/en/staff/settings`);
    await page.waitForURL("**/staff/mfa");
    check(true, "settings stay closed until 2-step setup is finished");

    const secret = (await page.textContent('[data-testid="mfa-secret"]'))!.trim();
    check((await page.locator("svg").count()) > 0, "setup page shows a QR code and the manual key");
    await page.fill("#code", "000000");
    await page.click('button:has-text("Finish setup")');
    await page.waitForSelector("text=didn't match");
    await page.fill("#code", code(secret));
    await page.click('button:has-text("Finish setup")');
    await page.waitForSelector("text=Welcome, Elena Admin");
    check(true, "a wrong code is refused; the right code finishes setup and opens staff home");

    // Hotel profile
    await page.click("text=Hotel settings");
    await page.waitForSelector("#name");
    await page.fill("#name", "E2E Grand Hotel");
    await page.click('button:has-text("Save profile")');
    await page.waitForSelector("text=Hotel profile saved.");
    await page.reload();
    check((await page.inputValue("#name")) === "E2E Grand Hotel", "hotel profile saves and survives a reload");

    // Departments
    await page.goto(`${BASE}/en/staff/settings/departments`);
    await page.fill("#code", "spa");
    await page.fill("#nameEn", "Spa");
    await page.fill("#nameAr", "السبا");
    await page.click('button:has-text("Add department")');
    await page.waitForSelector("text=Department SPA added.");
    await page.waitForSelector("text=Departments (7)");
    check(true, "a department is added and the list updates (6 defaults + SPA)");

    // Rooms
    await page.goto(`${BASE}/en/staff/settings/rooms`);
    await page.fill("#lines", "101-105, 1\n201-203, 2, Tower A");
    await page.click('button:has-text("Add rooms")');
    await page.waitForSelector("text=8 rooms added.");
    await page.waitForSelector("text=Rooms (8)");
    await page.fill("#lines", "105-106, 1");
    await page.click('button:has-text("Add rooms")');
    await page.waitForSelector("text=Already exist: 105");
    check((await page.locator("text=Rooms (8)").count()) === 1, "rooms are added in bulk; a batch with an existing room adds nothing");

    // Staff
    await page.goto(`${BASE}/en/staff/settings/staff`);
    await page.fill("#name", "Omar Attendant");
    await page.fill("#email", STAFF_EMAIL);
    const createForm = page.locator("form", { has: page.locator("#email") });
    await createForm.locator('select[name="role"]').selectOption("EMPLOYEE");
    await createForm.locator('select[name="departmentId"]').selectOption({ label: "HK · Housekeeping" });
    await page.click('button:has-text("Create account")');
    const staffTemp = (await page.textContent('[data-testid="secret"]'))!.trim();
    await page.waitForSelector("text=Staff (2)");
    check(staffTemp.length >= 10, "a staff account is created and its temporary password is shown once");

    // Services
    await page.goto(`${BASE}/en/staff/settings/services`);
    const amenities = page.locator('[data-category="amenities"]');
    await amenities.locator("summary", { hasText: "+ Add a service" }).click();
    const addForm = amenities.locator("form", { has: page.locator('button:has-text("Add service")') });
    await addForm.locator('input[name="nameEn"]').fill("Extra towels");
    await addForm.locator('input[name="nameAr"]').fill("مناشف إضافية");
    await addForm.locator('select[name="departmentId"]').selectOption({ label: "HK · Housekeeping" });
    await addForm.locator('input[name="maxQty"]').fill("4");
    await addForm.locator('button:has-text("Add service")').click();
    await amenities.locator("text=1 service").waitFor();
    check((await amenities.locator("summary", { hasText: "Extra towels" }).count()) === 1, "a service is added to a category and routed to Housekeeping");

    // Audit log
    await page.goto(`${BASE}/en/staff/settings/audit`);
    const audit = await page.textContent("table");
    const expected = ["hotel.created", "auth.mfa_enrolled", "hotel.updated", "department.created", "rooms.added", "staff.created", "service_item.created"];
    check(expected.every((a) => audit!.includes(a)), "the audit log shows every setup action");
    check(!audit!.includes(staffTemp) && !audit!.includes(ADMIN_PASSWORD), "no password appears in the audit log");

    // Sign out, sign back in → code required
    await page.goto(`${BASE}/en/staff`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/staff/login");
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL("**/staff/mfa");
    check((await page.locator('[data-testid="mfa-secret"]').count()) === 0, "next sign-in asks for a code and no longer reveals the key");
    await page.fill("#code", code(secret));
    await page.click('button:has-text("Verify")');
    await page.waitForSelector("text=Welcome, Elena Admin");
    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/staff/login");
    check(true, "the admin signs back in with password + code, then signs out");

    // The new employee
    await signIn(page, STAFF_EMAIL, staffTemp);
    await choosePassword(page, staffTemp, STAFF_PASSWORD);
    await page.waitForSelector("text=Welcome, Omar Attendant");
    check((await page.locator("text=Hotel settings").count()) === 0, "the new employee signs in, chooses a password, and sees no settings link");
    await page.goto(`${BASE}/en/staff/settings/staff`);
    await page.waitForSelector("text=Your role doesn't have access");
    check(page.url().includes("denied=1"), "the employee is turned away from settings by the server");

    console.log(`\nAll ${step} checks passed.`);
  } catch (e) {
    await page.screenshot({ path: "/tmp/e2e-failure.png", fullPage: true });
    console.error(`URL at failure: ${page.url()} (screenshot: /tmp/e2e-failure.png)`);
    throw e;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
