// Staff alert service worker (M4). Shows a pushed request alert and opens the request when tapped.
// Payload: { title, body, url } from src/server/push.ts — a request reference and room, never a guest name.

self.addEventListener("push", (event) => {
  let data = { title: "Request alert", body: "", url: "/en/staff/requests" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // A payload that is not JSON still shows the default alert.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.url, // a second alert for the same request replaces the first
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only same-origin paths are opened, so a payload cannot send staff to another site.
  const path = typeof event.notification.data?.url === "string" && event.notification.data.url.startsWith("/")
    ? event.notification.data.url
    : "/en/staff/requests";
  event.waitUntil(self.clients.openWindow(new URL(path, self.location.origin).href));
});
