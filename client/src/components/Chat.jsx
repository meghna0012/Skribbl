import { useEffect, useRef, useState } from 'react';

// One box for guesses and chat. This component does not know the secret word.
// It sends the text up, and the placeholder tells the player what the server will do with it.
export default function Chat({ messages, onSend, placeholder, disabled }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function submit(event) {
    event.preventDefault();
    const next = text.trim();
    if (!next || disabled) return;
    onSend(next);
    setText('');
  }

  return (
    <aside className="panel chat">
      <h2>Chat</h2>
      <div className="messages">
        {messages.length === 0 && <p className="muted">Guesses and chat show up here.</p>}
        {messages.map((message) => (
          <p key={message.id} className={message.system ? 'system' : 'line'}>
            {message.system ? message.text : (
              <>
                <b>{message.playerName}</b>
                <span>{message.text}</span>
              </>
            )}
          </p>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit}>
        <input
          value={text}
          maxLength={100}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="primary" disabled={disabled || !text.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
