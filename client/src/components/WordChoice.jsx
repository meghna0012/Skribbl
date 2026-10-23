// Shown only to the drawer. The words arrived on their socket alone.
// The countdown is the server's choose timer, not a local 15s.
export default function WordChoice({ words, timeLeft, onChoose }) {
  return (
    <div className="overlay">
      <p className="eyebrow">Choose a word</p>
      <p className="overlay-time">{timeLeft}s</p>
      <div className="choices">
        {words.map((word) => (
          <button key={word} type="button" className="choice" onClick={() => onChoose(word)}>
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}
