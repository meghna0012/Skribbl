// What: the line above the canvas.
// Why: the drawer and anyone who already guessed may see the real word, because they know it.
// Everyone else sees the mask. During choosing we do not show blanks yet, only who is picking.
export default function HintBar({
  phase,
  isDrawer,
  drawerName,
  mask,
  yourWord,
  guessed,
  paused,
}) {
  let text = 'Waiting for the next round';
  let kind = 'muted';

  if (phase === 'choosing') {
    text = isDrawer ? 'Choose a word' : `${drawerName} is choosing a word`;
  } else if (phase === 'drawing' && paused) {
    text = 'Drawer disconnected. Timer paused.';
  } else if (phase === 'drawing' && (isDrawer || guessed) && yourWord) {
    text = yourWord;
    kind = 'word';
  } else if (phase === 'drawing') {
    text = mask || '_';
    kind = 'mask';
  } else if ((phase === 'roundEnd' || phase === 'gameOver') && yourWord) {
    text = yourWord;
    kind = 'word';
  }

  return (
    <div className={`hintbar ${kind}`}>
      <p>{text}</p>
      {guessed && phase === 'drawing' && <small>You guessed it</small>}
    </div>
  );
}
