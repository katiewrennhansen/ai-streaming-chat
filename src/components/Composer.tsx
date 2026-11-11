import { Button, TextArea } from "@heroui/react";
import { useState, type KeyboardEvent, type SubmitEventHandler } from "react";

type ComposerProps = {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

export const Composer = ({ isStreaming, onSend, onStop }: ComposerProps) => {
  const [text, setText] = useState("");

  const handleSubmitText = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmitText();
    }
  };

  const handleFormSubmit: SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    handleSubmitText();
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  return (
    <form className="flex items-end gap-2" onSubmit={handleFormSubmit}>
      <TextArea
        aria-label="Message"
        rows={1}
        fullWidth
        value={text}
        placeholder={
          isStreaming ? "Responding… press Esc to stop" : "Ask something…"
        }
        onChange={handleTextChange}
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
};
