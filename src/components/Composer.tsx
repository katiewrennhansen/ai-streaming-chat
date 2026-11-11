import { Button, TextArea } from '@heroui/react';
import { memo, useState, type FormEvent, type KeyboardEvent } from 'react';

interface Props {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/** The input's state lives here, so typing never re-renders the message list. */
export const Composer = memo(function Composer({ isStreaming, onSend, onStop }: Props) {
  const [text, setText] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
  };

  // Enter sends, Shift+Enter adds a new line, Esc stops a streaming reply.
  // `isComposing` skips Enter while an IME (e.g. Japanese input) is active.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && isStreaming) {
      onStop();
    }
  };

  return (
    <form className="flex items-end gap-2" onSubmit={submit}>
      <TextArea
        aria-label="Message"
        rows={1}
        fullWidth
        value={text}
        placeholder={isStreaming ? 'Responding… press Esc to stop' : 'Ask something…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        className="max-h-40 resize-none"
      />
      {isStreaming ? (
        <Button variant="secondary" onPress={onStop}>
          Stop
        </Button>
      ) : (
        <Button type="submit" variant="primary" isDisabled={!text.trim()}>
          Send
        </Button>
      )}
    </form>
  );
});
