import assert from 'node:assert/strict';
import { NotebookEditHistory } from '../../web/notebook-edit-history.mjs';
import { WritingInput } from '../../web/writing-input.mjs';
import { cardText, deckBody } from '../../web/deck.mjs';
import { writingPort } from './card_text_867.mjs';

class Input extends Event {
  constructor(type, options = {}) {
    super(type, { cancelable: true, ...options });
    this.inputType = options.inputType;
  }
}

// Real Notebook key, card act/placement, history, save and NotebookWriting
// owners. Field/paint/transport are explicit memory ports, not native input,
// geometry, focus order or durable Core evidence.
export async function boundaryPage(t, body = '## A\n\nA words\n\n## B\n\nB words\n\n### B child\n\nchild\n\n## C\n\nC words\n') {
  const f = await writingPort(t, body), { p } = f, histories = [];
  p.mode = 'cards'; p.keyed = false; p.holdPage = () => () => {};
  p.open = editing => {
    const field = new EventTarget();
    Object.assign(field, { value: editing.shown ?? editing.text, readOnly: false,
      setSelectionRange(start, end, direction = 'none') {
        this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
      },
      setRangeText(text, start, end) {
        this.value = this.value.slice(0, start) + text + this.value.slice(end);
        this.setSelectionRange(start + text.length, start + text.length);
      },
      closest() { return null; },
      replace(text, inputType = 'insertText') {
        this.dispatchEvent(new Input('beforeinput', { inputType }));
        this.setRangeText(text, this.selectionStart, this.selectionEnd);
        this.dispatchEvent(new Input('input', { inputType }));
      },
    });
    field.ownerDocument = { defaultView: { InputEvent: Input },
      execCommand(command, _ui, text) { field.replace(command === 'delete' ? '' : text); return true; } };
    const at = editing.at ?? field.value.length;
    field.setSelectionRange(at, at);
    const input = new WritingInput({ field, mac: true });
    const history = new NotebookEditHistory({ field, mac: true }); histories.push(history);
    p.editing = { ...editing, field, input, history };
    field.addEventListener('input', () => p.save());
    p.doc.activeElement = field;
  };
  const edit = (at = 1, edge = 'end') => {
    p.picked = at; p.edit();
    const field = p.editing.field, point = edge === 'start' ? 0 : field.value.length;
    field.setSelectionRange(point, point); return field;
  };
  const press = (key, extra = {}) => {
    const event = { key, target: p.editing?.field ?? p.list,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...extra };
    p.key(event); return event;
  };
  t.after(() => { for (const history of histories) history.close(); p.listening.abort(); });
  return { ...f, edit, press };
}

export const outline = p => p.deck.cards.map(card => [card.title, card.depth]);
export const state = field => [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
export function retained(p, editor, before) {
  assert.equal(p.editing, editor);
  assert.equal(p.editing.field, editor.field);
  assert.deepEqual(state(editor.field), before);
}
export { cardText, deckBody };
