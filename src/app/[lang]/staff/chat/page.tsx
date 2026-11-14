import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { card, input, label } from "@/components/ui";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { CHAT_MAX_BODY, listChatChannels, listChatMessages } from "@/server/chat";
import { formatHotelTime } from "@/server/requests/labels";
import { postMessageAction } from "./actions";

export const metadata = { title: "Team chat" };

/** Same live interval as the request queue (spec: chat is polled every 5 seconds). */
const CHAT_POLL_MS = 5000;

export default async function TeamChat({ searchParams }: PageProps<"/[lang]/staff/chat">) {
  const actor = await requireStaff();
  const { channel } = await searchParams;
  const channels = await listChatChannels(actor);
  const active = channels.find((c) => c.id === channel) ?? channels[0];
  const read = active ? await listChatMessages(actor, active.id) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <AutoRefresh intervalMs={CHAT_POLL_MS} />
      <Link href={STAFF_BASE} className="text-sm text-navy underline">Staff home</Link>
      <h1 className="mt-2 mb-4 font-display text-3xl text-navy">Team chat</h1>

      {!active ? (
        <p className={`${card} text-sm text-charcoal/70`}>There is no department channel for your role.</p>
      ) : (
        <>
          <nav aria-label="Channels" className="mb-4 flex flex-wrap gap-2">
            {channels.map((c) => (
              <Link
                key={c.id}
                href={`${STAFF_BASE}/chat?channel=${c.id}`}
                aria-current={c.id === active.id ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${c.id === active.id ? "border-navy bg-navy text-ivory" : "border-soft-gray bg-white text-navy hover:border-champagne-dark"}`}
              >
                {c.departmentName}
              </Link>
            ))}
          </nav>

          <section className={`${card} mb-4`} aria-labelledby="messages">
            <h2 id="messages" className="mb-4 font-medium text-navy">{active.departmentName}</h2>
            {!read?.ok ? (
              <p className="text-sm text-red-700">{read?.message ?? "This channel could not be loaded."}</p>
            ) : read.messages.length === 0 ? (
              <p className="text-sm text-charcoal/70">No messages yet.</p>
            ) : (
              <ol className="grid gap-3" aria-live="polite">
                {read.messages.map((m) => (
                  <li key={m.id} className="border-l-2 border-champagne pl-3 text-sm">
                    <span className="block text-xs text-charcoal/60">{m.authorName} · {formatHotelTime(m.createdAt)}</span>
                    <span className="whitespace-pre-wrap">{m.body}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {active.canPost ? (
            <ActionForm action={postMessageAction} submitLabel="Send" pendingLabel="Sending…" className={card}>
              <input type="hidden" name="channelId" value={active.id} />
              <label className={label} htmlFor="body">Message</label>
              <textarea id="body" name="body" required maxLength={CHAT_MAX_BODY} rows={2} className={`${input} mb-3`} />
            </ActionForm>
          ) : (
            <p className="text-sm text-charcoal/70">You can read this channel. Only its department&apos;s members post here.</p>
          )}
        </>
      )}
    </main>
  );
}
