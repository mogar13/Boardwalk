import { useState } from 'react';
import { Button, Card, Input } from '@/ui';
import { useChat } from '@/system/chat/useChat';
import { useRoom } from '@/system/room/useRoom';

/**
 * The room chat — a message list and a composer, both from `src/ui`. It is a plain reader of
 * `useChat()`: the subscription, the ordering and the author-pinning all live below it, so this
 * component is just presentation. Own messages take the cyan "here" tint; everyone else's stay
 * neutral — the same restraint the theme uses everywhere (one accent, meaning "you").
 */
export function ChatPanel() {
  const { messages, send } = useChat();
  const { myId } = useRoom();
  const [draft, setDraft] = useState('');

  const submit = () => {
    send(draft); // sanitizes and drops an empty message itself
    setDraft('');
  };

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <h3 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
        Chat
      </h3>

      <div className="flex min-h-32 flex-1 flex-col gap-1.5 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-bw-muted text-sm">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <p key={m.key} className="text-sm">
              <span
                className={
                  m.uid === myId
                    ? 'text-secondary font-semibold'
                    : 'text-base-content font-semibold'
                }
              >
                {m.name}
              </span>
              <span className="text-bw-muted">: </span>
              <span className="text-base-content">{m.text}</span>
            </p>
          ))
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
