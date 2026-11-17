# Room-service ordering with the Ostro menu — design

**Status:** draft, awaiting approval. Nothing is built yet.

## Intent

A guest with an active stay opens the guest page, browses the Ostro menu, adds items to a cart, and places one room-service order. The order goes to the Food & Beverage department's queue as a single request with its own SLA timer, so staff track it with the tools they already use (accept, start, complete, transfer, escalate, chat).

## Decisions made with Michael

- The Ostro menu is copied into the hotel's existing service catalogue. It is not read live from the Ostro project.
- The menu is kept exactly as it is in Ostro. The copy lives at `prisma/data/ostro-menu.sql`. It matches Ostro's `seed/seed.sql` except for two biryani prices, which follow the current Ostro menu: Chicken Biryani AED 59 and Mutton Biryani AED 75. Its 17 categories and 127 products are imported with the same names, descriptions, and availability, and with the two biryani prices above.
- One cart becomes one order. Staff see one order with all its lines.
- Guests pay on delivery. The app records no payment and takes no money.
- English only at launch. Arabic is a later step.

## Facts from the code

- `ServiceItem` already has `price` (nullable, "post-MVP in-room dining uses it"), `departmentId` (routing), `isActive`, and `nameEn`/`nameAr`.
- `Request` holds one `serviceItemId` and a `qty`. It has no notion of several lines.
- The guest catalogue is at `/[lang]/g/[token]/[category]/[item]`. Requests are created through the existing guest server code.

## Approach (chosen)

1. **Catalogue import.** A script reads `prisma/data/ostro-menu.sql`. The file is SQLite syntax, so the script parses its `INSERT` statements rather than running them against Postgres. It creates or updates `ServiceCategory` and `ServiceItem` rows for the hotel. Items are matched by a stable key, so re-running the script updates prices and names without duplicates. Ostro's `available` flag maps to `isActive`.
2. **One umbrella item.** A catalogue item "Room service order" routed to F&B is the single `serviceItemId` every order uses. This keeps SLA, queue, alerts, transfer and chat working unchanged.
3. **Order lines.** A new `ServiceOrder` row is linked one-to-one with its `Request`. A new `ServiceOrderLine` row holds each item with its name and unit price copied at order time, plus its quantity.
4. **Pricing on the server.** The browser sends only item ids and quantities. The server reads prices from the catalogue and totals them, so a changed or forged browser price is ignored.
5. **Cart.** Kept in the browser for the session. It is checked again on the server when the order is placed.

## My calls (not yet confirmed by Michael)

- **Arabic name placeholder.** `nameAr` is required, so until translations exist it holds the English name.
- **No images, no delivery fee, no opening hours.** Ostro has no photos yet and its delivery fee is 0. Kitchen availability is controlled only by the `isActive` flag.
- **Quantity cap.** Each line is capped at 20.
- **Order note.** The existing `guestNote` field carries the guest's note on the order.
- **Stay required.** Orders can only be placed on an active stay, the same rule as requests.

## Acceptance criteria

1. A guest with an active stay sees the menu on their guest page, grouped by the 17 Ostro categories.
2. Adding items and placing an order creates one `Request` in F&B with one `ServiceOrder` and the right lines and total.
3. A client-sent price or an inactive item is rejected or ignored; the server total is used.
4. An empty cart, a quantity over 20, or a stay that is not active is refused.
5. F&B staff see the order's lines and total on the request screen.
6. Running the import twice leaves the same rows (no duplicates) and updates changed prices.
7. Each of these has a test written first that fails before the code exists.

## Out of scope

Payment in the app, Arabic translations, Telegram and the Ostro website, a live Ostro API, images, delivery fees, and multiple rooms per order.

## Decided

- Room-service orders are routed to the existing Food & Beverage department (it appears as a channel in the staff team chat).
