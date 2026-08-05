import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input, cx } from '@/ui';
import { groupMessages } from '@/system/chat/grouping';
import { useChat } from '@/system/chat/useChat';
import { useRoom } from '@/system/room/useRoom';

/**
 * The room chat — a message list and a composer, both from `src/ui`. It is a plain reader of
 * `useChat()`: the subscription, the ordering and the author-pinning all live below it, and the
 * shape of the log lives in `groupMessages`, so this component is just presentation. Own messages
 * take the cyan "here" tint; everyone else's stay neutral — the same restraint the theme uses
 * everywhere (one accent, meaning "you").
 *
 * THREE THINGS KEEP IT FROM RUNNING OFF THE PAGE, and they are separate problems that looked like
 * one:
 *
 *   1. IT IS BOUNDED. The list used to have `overflow-y-auto` and nothing to overflow: its height
 *      came from its content through a grid row that sized to whichever column was taller, so the
 *      panel simply grew and took the page with it — the scrollbar it asked for could never appear
 *      because there was no height to exceed. A `max-h` is the actual bound, and it is what makes
 *      the other two behaviours mean anything.
 *   2. IT FOLLOWS THE TAIL — but only while the reader is already at the tail. A log that does not
 *      follow its own tail shows you the first thing anyone said for the rest of the game (the
 *      `MoveLog` rule); one that follows it unconditionally yanks a reader out of scrollback every
 *      time somebody types. Hence the pin, released by scrolling up and taken back by the button.
 *   3. IT SAYS REPETITION ONCE. A run of identical lines is one line and a count. See `grouping.ts`
 *      for why the collapse is strictly local.
 */

/** How close to the bottom still counts as reading the live end rather than scrollback. */
const NEAR_BOTTOM_PX = 48;

export function ChatPanel() {
  const { messages, send } = useChat();
  const { myId } = useRoom();
  const [draft, setDraft] = useState('');
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const box = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  const count = messages.length;

  useEffect(() => {
    const el = box.current;
    if (el === null || !pinned) return;
    el.scrollTop = el.scrollHeight;
    setSeenCount(count);
  }, [count, pinned]);

  // Only meaningful while unpinned — pinned, `seenCount` tracks `count` and this is always 0.
  const missed = Math.max(0, count - seenCount);

  const submit = () => {
    send(draft); // sanitizes and drops an empty message itself
    setDraft('');
    setPinned(true); // sending is asking to see the end of the conversation
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
        Chat
      </h3>

      <div className="flex flex-col gap-2">
        <div
          ref={box}
          onScroll={() => {
            const el = box.current;
            if (el === null) return;
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX);
          }}
          className="flex max-h-[60vh] min-h-32 flex-col gap-2 overflow-y-auto overscroll-contain"
          aria-live="polite"
          // "Chat log", not "Chat messages": the composer below is labelled "Chat message", and two
          // controls whose accessible names differ by one letter are one control to anybody
          // listening rather than looking.
          aria-label="Chat log"
        >
          {groups.length === 0 ? (
            <p className="text-bw-muted text-sm">No messages yet.</p>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="flex flex-col">
                <span
                  className={cx(
                    'text-sm font-semibold',
                    group.uid === myId ? 'text-secondary' : 'text-base-content'
                  )}
                >
                  {group.name}
                </span>
                {group.lines.map((line) => (
                  <p key={line.key} className="text-base-content text-sm break-words">
                    {line.text}
                    {line.repeat > 1 && (
                      <span className="text-bw-muted ml-1.5 text-xs tabular-nums">
                        ×{line.repeat}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            ))
          )}
        </div>

        {/* The way back down. Without it, releasing the pin on scroll strands a reader at the top
            of a conversation that is still moving, with no sign that it is.

            IN THE FLOW, NOT FLOATING OVER THE LOG. The obvious build is the pill every chat app
            floats above its last line, and a screenshot is the only thing that shows what is wrong
            with it here: the panel is narrow, so the pill lands squarely on top of the newest
            message and hides the very thing it is advertising. A full-width bar under the log
            costs ~32px while it is shown and covers nothing. */}
        {!pinned && (
          <Button
            // The weight matches the news. Cyan ("here") when messages have actually arrived while
            // you were reading back; quiet when it is only a way down from a log nobody has added
            // to — a full-width lit bar for "nothing happened" spends the glow budget on silence.
            variant={missed > 0 ? 'secondary' : 'quiet'}
            size="sm"
            className="w-full"
            onClick={() => {
              setPinned(true);
            }}
          >
            {missed > 0 ? `${String(missed)} new ↓` : 'Latest ↓'}
          </Button>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          aria-label="Chat message"
          placeholder="Say something…"
          value={draft}
          maxLength={500}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" size="md" disabled={draft.trim() === ''}>
          Send
        </Button>
      </form>
    </Card>
  );
}
