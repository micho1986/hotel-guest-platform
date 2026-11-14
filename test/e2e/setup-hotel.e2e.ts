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
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { Client } from "pg";
import { chromium, type Page } from "playwright-core";
import { totpAt } from "../../src/server/auth/totp";

const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const slug = `e2e-${Date.now()}`;
const ADMIN_EMAIL = "admin@e2e.test";
const ADMIN_PASSWORD = "Walkthrough-Pass-1";
const STAFF_EMAIL = "attendant@e2e.test";
const STAFF_PASSWORD = "Attendant-Pass-2";
const FD_EMAIL = "frontdesk@e2e.test";
const FD_PASSWORD = "Front-Desk-Pass-3";
// M4 accounts
const SUP_EMAIL = "supervisor@e2e.test";
const SUP_PASSWORD = "Supervisor-Pass-4";
const HK2_EMAIL = "housekeeper@e2e.test";
const HK2_PASSWORD = "Housekeeper-Pass-5";
const ENG_EMAIL = "engineer@e2e.test";
const ENG_PASSWORD = "Engineer-Pass-6";

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

/** Creates a staff account from the settings screen and returns its one-time temporary password. */
async function createStaff(page: Page, name: string, email: string, role: string, department: string, expectedCount: number) {
  await page.fill("#name", name);
  await page.fill("#email", email);
  const form = page.locator("form", { has: page.locator("#email") });
  await form.locator('select[name="role"]').selectOption(role);
  await form.locator('select[name="departmentId"]').selectOption({ label: department });
  await page.click('button:has-text("Create account")');
  await page.waitForSelector(`text=Staff (${expectedCount})`);
  return (await page.textContent('[data-testid="secret"]'))!.trim();
}

async function signOut(page: Page) {
  await page.goto(`${BASE}/en/staff`);
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/staff/login");
}

/** First sign-in of a new account: temporary password, then the chosen one. */
async function firstSignIn(page: Page, email: string, temp: string, password: string, name: string) {
  await signIn(page, email, temp);
  await choosePassword(page, temp, password);
  await page.waitForSelector(`text=Welcome, ${name}`);
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

    // Front desk account: hotel-wide role, no department
    await page.fill("#name", "Freya Front Desk");
    await page.fill("#email", FD_EMAIL);
    await page.locator("form", { has: page.locator("#email") }).locator('select[name="role"]').selectOption("FRONT_DESK");
    await page.click('button:has-text("Create account")');
    await page.waitForSelector("text=Staff (3)");
    const fdTemp = (await page.textContent('[data-testid="secret"]'))!.trim();

    // M4 accounts: a Housekeeping supervisor, a second housekeeper and an engineer
    const supTemp = await createStaff(page, "Sara Supervisor", SUP_EMAIL, "SUPERVISOR", "HK · Housekeeping", 4);
    const hk2Temp = await createStaff(page, "Hamid Housekeeper", HK2_EMAIL, "EMPLOYEE", "HK · Housekeeping", 5);
    const engTemp = await createStaff(page, "Ezra Engineer", ENG_EMAIL, "EMPLOYEE", "ENG · Engineering", 6);

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

    // Concierge item that takes a note, so guests can ask for anything else
    const concierge = page.locator('[data-category="concierge"]');
    await concierge.locator("summary", { hasText: "+ Add a service" }).click();
    const conciergeForm = concierge.locator("form", { has: page.locator('button:has-text("Add service")') });
    await conciergeForm.locator('input[name="nameEn"]').fill("Ask the concierge");
    await conciergeForm.locator('input[name="nameAr"]').fill("اسأل الكونسيرج");
    await conciergeForm.locator('select[name="departmentId"]').selectOption({ label: "CONC · Concierge" });
    await conciergeForm.locator('input[name="maxQty"]').fill("1");
    await conciergeForm.locator('input[name="needsNote"]').check();
    await conciergeForm.locator('button:has-text("Add service")').click();
    await concierge.locator("text=1 service").waitFor();

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

    // Front desk: check a guest in, then walk the guest journey through the printed links
    await page.goto(`${BASE}/en/staff`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/staff/login");
    await signIn(page, FD_EMAIL, fdTemp);
    await choosePassword(page, fdTemp, FD_PASSWORD);
    await page.waitForSelector("text=Welcome, Freya Front Desk");
    check((await page.locator('a[href$="/front-desk/stays"]').count()) === 1, "the front desk sees the front desk link on staff home");

    await page.goto(`${BASE}/en/staff/front-desk`);
    await page.locator('select[name="roomId"]').selectOption({ index: 0 });
    await page.fill("#guestDisplayName", "E2E Guest");
    const today = new Date();
    await page.fill("#checkIn", today.toISOString().slice(0, 10));
    await page.fill("#checkOut", new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10));
    await page.click('button:has-text("Check in and print card")');
    await page.waitForURL("**/front-desk/stays/*/card");
    const cardLinks = (await page.locator("p.break-all").allTextContents()).map((s) => s.trim());
    const [enLink, arLink] = cardLinks;
    check(cardLinks.length === 2 && enLink.startsWith(`${BASE}/en/g/`) && arLink.startsWith(`${BASE}/ar/g/`), "check-in prints a card with the English and Arabic guest links");

    await page.goto(enLink);
    check((await page.locator("text=Room Amenities").count()) >= 1, "the English link opens the category list");
    await page.goto(arLink);
    check((await page.locator('html[dir="rtl"]').count()) === 1, "the Arabic link renders right to left");

    await page.goto(`${enLink}/amenities`);
    await page.click('a:has-text("Extra towels")');
    await page.click('button:has-text("Send request")');
    await page.waitForURL("**/g/*/requests/*");
    const towelGuestUrl = page.url();
    const towelRef = (await page.textContent("body"))!.match(/HK-\d{4}/)?.[0];
    await page.goto(enLink);
    await page.click('a:has-text("My requests")');
    await page.waitForURL("**/g/*/requests");
    check(!!towelRef && (await page.textContent("body"))!.includes(towelRef), "the guest's catalogue request appears in My requests with its reference");

    await page.goto(`${enLink}/concierge`);
    await page.click('a:has-text("Ask the concierge")');
    await page.fill('textarea[name="guestNote"]', "Late checkout for room 101 please");
    await page.click('button:has-text("Send request")');
    await page.waitForURL("**/g/*/requests/*");
    const conciergeRef = (await page.textContent("body"))!.match(/CONC-\d{4}/)?.[0];
    check(!!conciergeRef, "the concierge request with a note is routed to Concierge");

    // M3 — requests core: the guest's request reaches Housekeeping, staff work it, the guest follows along
    await page.goto(`${BASE}/en/staff`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/staff/login");
    await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
    await page.waitForSelector("text=Welcome, Omar Attendant");
    await page.goto(`${BASE}/en/staff/requests?tab=new`);
    await page.waitForSelector(`text=${towelRef}`);
    const queue = (await page.textContent("body")) ?? "";
    check(queue.includes("Extra towels") && queue.includes(towelRef!) && !queue.includes(conciergeRef!),
      "the towel request is in Housekeeping's queue as New, and the concierge request is not");

    await page.click(`a:has-text("${towelRef}")`);
    await page.waitForURL("**/staff/requests/*");
    const staffUrl = page.url();
    await page.fill('textarea[name="reason"]', "   ");
    await page.click('button:has-text("Reject and return to queue")');
    await page.waitForSelector("text=Give a reason for rejecting this request.");
    await page.fill('textarea[name="reason"]', "No towels in stock until tomorrow");
    await page.click('button:has-text("Reject and return to queue")');
    await page.waitForSelector("text=Rejected. It is back in the queue.");
    check(true, "a rejection with no reason is refused; with a reason the request returns to the queue");

    await page.getByRole("button", { name: "Accept request", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).waitFor();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Waiting for guest", exact: true }).waitFor();

    const guestContext = await browser.newContext({ viewport: { width: 420, height: 800 } });
    const guestPage = await guestContext.newPage();
    await guestPage.goto(towelGuestUrl);
    await page.fill("#wait-reason", "guest not in room");
    await page.getByRole("button", { name: "Waiting for guest", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Mark completed", exact: true }).waitFor();
    check(true, "the attendant accepts, starts, waits for the guest with a note, resumes and is ready to complete");

    await page.getByRole("button", { name: "Mark completed", exact: true }).click();
    await guestPage.getByRole("button", { name: "Send rating", exact: true }).waitFor({ timeout: 10_000 });
    check(true, "the guest's open page shows Completed and the rating form within 10 seconds, without a reload");

    await guestPage.locator('input[name="rating"][value="4"]').check();
    await guestPage.fill('textarea[name="comment"]', "Quick, thank you");
    await guestPage.getByRole("button", { name: "Send rating", exact: true }).click();
    await guestPage.waitForSelector("text=You have already rated this request.");
    check(
      (await guestPage.locator('input[name="rating"]').count()) === 0,
      "the guest rates 4 stars once; the rating form is then replaced, so a second rating cannot be sent",
    );
    await guestContext.close();

    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
    writeFileSync("/tmp/e2e-photo.png", png);
    await page.goto(staffUrl);
    await page.setInputFiles('input[name="photo"]', "/tmp/e2e-photo.png");
    await page.getByRole("button", { name: "Upload photo", exact: true }).click();
    await page.locator(`img[alt="Photo for request ${towelRef}"]`).waitFor();
    await page.reload();
    const photoLoaded = await page
      .locator(`img[alt="Photo for request ${towelRef}"]`)
      .evaluate((el) => {
        const img = el as unknown as { complete: boolean; naturalWidth: number };
        return img.complete && img.naturalWidth > 0;
      });
    check(photoLoaded, "the attendant uploads a small PNG, and it opens again on the request");

    // M4 — supervisors, alerts, transfer and chat
    const jobSecret = process.env.ALERT_JOB_SECRET;
    check(jobSecret, "ALERT_JOB_SECRET is set for the app and this walkthrough");
    const db = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await db.connect();
    const alertsFor = async (ref: string) =>
      Number(
        (
          await db.query(
            `SELECT count(*) FROM notifications n JOIN requests r ON r.id = n.request_id JOIN hotels h ON h.id = r.hotel_id
             WHERE h.slug = $1 AND r.public_ref = $2 AND n.type = 'REQUEST_ALERT'`,
            [slug, ref],
          )
        ).rows[0].count,
      );
    const runJob = async () => {
      const res = await fetch(`${BASE}/api/jobs/alerts`, { headers: { Authorization: `Bearer ${jobSecret}` } });
      return res.status;
    };
    try {
      check((await fetch(`${BASE}/api/jobs/alerts`)).status === 401, "the alert job route refuses a call without the secret");

      const urgentContext = await browser.newContext({ viewport: { width: 420, height: 800 } });
      const urgentGuest = await urgentContext.newPage();
      await urgentGuest.goto(`${enLink}/amenities`);
      await urgentGuest.click('a:has-text("Extra towels")');
      await urgentGuest.click('button:has-text("Send request")');
      await urgentGuest.waitForURL("**/g/*/requests/*");
      const urgentRef = (await urgentGuest.textContent("body"))!.match(/HK-\d{4}/)?.[0];
      await urgentContext.close();
      await db.query(
        `UPDATE requests SET priority = 'URGENT' WHERE public_ref = $2 AND hotel_id = (SELECT id FROM hotels WHERE slug = $1)`,
        [slug, urgentRef],
      );
      check((await alertsFor(urgentRef!)) === 1, "a new request alerts the Housekeeping supervisor at once");
      check((await runJob()) === 200 && (await alertsFor(urgentRef!)) === 1, "it is not alerted again inside its 5-minute window");

      // Five minutes pass: the request has been New for longer than the urgent window. Shifted from its own
      // created_at, not SQL now(), so the check holds whatever time zone the app's driver writes in.
      await db.query(
        `UPDATE requests SET created_at = created_at - interval '5 minutes 5 seconds',
                             alerted_at = alerted_at - interval '5 minutes 5 seconds'
         WHERE public_ref = $2 AND hotel_id = (SELECT id FROM hotels WHERE slug = $1)`,
        [slug, urgentRef],
      );
      check((await runJob()) === 200 && (await alertsFor(urgentRef!)) === 2, "after 5 minutes still New, the alert job alerts the supervisor again");
      await runJob();
      check((await alertsFor(urgentRef!)) === 2, "running the job again in the same window does not alert twice");

      await signOut(page);
      await firstSignIn(page, SUP_EMAIL, supTemp, SUP_PASSWORD, "Sara Supervisor");
      await page.goto(`${BASE}/en/staff/requests?tab=new`);
      await page.waitForSelector("text=1 request alert");
      check((await page.textContent("body"))!.includes(urgentRef!), "the supervisor's queue shows the alert and the urgent request");

      await page.click(`a:has-text("${urgentRef}")`);
      await page.waitForURL("**/staff/requests/*");
      const urgentStaffUrl = page.url();
      await page.locator('select[name="staffId"]').selectOption({ label: "Omar Attendant" });
      await page.getByRole("button", { name: "Assign", exact: true }).click();
      await page.waitForSelector("text=Assigned to Omar Attendant.");
      await page.locator('select[name="staffId"]').selectOption({ label: "Hamid Housekeeper" });
      await page.getByRole("button", { name: "Reassign", exact: true }).click();
      await page.waitForSelector("text=Reassigned to Hamid Housekeeper.");
      await page.goto(`${BASE}/en/staff/requests?tab=new`);
      check((await page.locator("text=request alert").count()) === 0, "the supervisor assigns, then reassigns; opening the request cleared the alert");

      await signOut(page);
      await firstSignIn(page, HK2_EMAIL, hk2Temp, HK2_PASSWORD, "Hamid Housekeeper");
      await page.goto(urgentStaffUrl);
      await page.locator('select[name="departmentId"]').selectOption({ label: "Engineering" });
      await page.fill("#transfer-reason", "Leaking towel rail, needs engineering");
      await page.getByRole("button", { name: "Transfer request", exact: true }).click();
      await page.waitForURL("**/staff/requests?tab=new&transferred=1");
      await page.waitForSelector("text=Request transferred.");
      // Next keeps the previous page mounted but hidden, so only visible text counts.
      await page.waitForSelector("text=Nothing here right now.");
      check((await page.locator(`text=${urgentRef} >> visible=true`).count()) === 0, "the transferred request leaves Housekeeping's queue");
      check(true, "the housekeeper transfers the request to Engineering with a reason");

      // Chat: Omar has Housekeeping's channel open; Hamid posts; it appears without a reload.
      const omarContext = await browser.newContext({ viewport: { width: 420, height: 800 } });
      const omar = await omarContext.newPage();
      await signIn(omar, STAFF_EMAIL, STAFF_PASSWORD);
      await omar.waitForSelector("text=Welcome, Omar Attendant");
      await omar.goto(`${BASE}/en/staff/chat`);
      await omar.waitForSelector("text=No messages yet.");
      const chatLine = `Linen trolley on floor 2 ${Date.now()}`;
      await page.goto(`${BASE}/en/staff/chat`);
      await page.fill("#body", chatLine);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.waitForSelector("text=Sent.");
      await omar.waitForSelector(`text=${chatLine}`, { timeout: 10_000 });
      check(true, "a chat message from Housekeeping appears for another member of Housekeeping within 10 seconds");
      await omarContext.close();

      await signOut(page);
      await firstSignIn(page, ENG_EMAIL, engTemp, ENG_PASSWORD, "Ezra Engineer");
      await page.goto(`${BASE}/en/staff/requests?tab=new`);
      await page.waitForSelector(`text=${urgentRef}`);
      check(true, "the transferred request appears in Engineering's queue as New");
      await page.goto(`${BASE}/en/staff/chat`);
      await page.waitForSelector("text=Engineering");
      check((await page.locator(`text=${chatLine} >> visible=true`).count()) === 0, "Engineering's channel does not show Housekeeping's message");

      // Concierge and Engineering have no supervisor: their New requests alert the hotel admin, who sees
      // them on staff home (CONC request at creation, the transferred HK request on transfer).
      await signOut(page);
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.waitForURL("**/staff/mfa");
      await page.fill("#code", code(secret));
      await page.click('button:has-text("Verify")');
      await page.waitForSelector("text=Welcome, Elena Admin");
      await page.waitForSelector("text=2 request alerts");
      check(true, "the hotel admin sees the fallback alerts for departments with no supervisor on staff home");
    } finally {
      await db.end();
    }

    // Back to the front desk, so the guest can be checked out below
    await page.goto(`${BASE}/en/staff`);
    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/staff/login");
    await signIn(page, FD_EMAIL, FD_PASSWORD);
    await page.waitForSelector("text=Welcome, Freya Front Desk");

    await page.goto(`${BASE}/en/staff/front-desk/stays`);
    await page.locator("tr", { hasText: "E2E Guest" }).locator('button:has-text("Check out")').click();
    await page.waitForSelector("text=Checked out");
    await page.goto(enLink);
    check((await page.locator("text=This link is no longer active.").count()) === 1, "after check-out the same link shows the no-longer-active message");

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
