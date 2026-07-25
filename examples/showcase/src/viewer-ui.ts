/**
 * Shared chrome for the reference viewers.
 *
 * A viewer is a page embedded in a generated reference page, selected by URL
 * fragment. Each declares parameters; this module renders them, reports the
 * counts the viewer computes, and reports a failure in the frame rather than
 * only to the console, since an embedded page has no other way to say so.
 */
import './viewer-chrome.css';

export interface NumericParam {
  readonly kind?: 'number';
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}

/** A ringed node of a Coxeter diagram, or any other on/off construction flag. */
export interface ToggleParam {
  readonly kind: 'toggle';
  readonly name: string;
  readonly label: string;
  readonly value: boolean;
}

/** A named alternative, such as which rank-4 Coxeter group to act with. */
export interface ChoiceParam {
  readonly kind: 'choice';
  readonly name: string;
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
}

export type Param = NumericParam | ToggleParam | ChoiceParam;

export interface Values {
  readonly number: (name: string) => number;
  readonly toggle: (name: string) => boolean;
  readonly choice: (name: string) => string;
}

/** Reads the fragment once, which is what an embedding iframe provides. */
export function selectedEntry(fallback: string): string {
  // Reload on a fragment change so the page is also navigable on its own.
  window.addEventListener('hashchange', () => location.reload());
  return decodeURIComponent(location.hash.slice(1)) || fallback;
}

export function reportFailure(message: string): void {
  const box = document.getElementById('err');
  if (!box) return;
  box.style.display = 'grid';
  box.textContent = message;
}

export function setTitle(text: string): void {
  const title = document.getElementById('title');
  if (title) title.textContent = text;
}

/**
 * Renders the parameter controls and returns readers for their current values.
 * `onChange` runs after any control moves.
 */
export function bindControls(params: readonly Param[], onChange: () => void): Values {
  const state: Record<string, number | boolean | string> = {};
  for (const p of params) state[p.name] = p.value;

  const host = document.getElementById('controls');
  if (host) {
    for (const p of params) {
      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('label');
      label.textContent = p.label;
      row.append(label);

      if (p.kind === 'toggle') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = p.value;
        input.addEventListener('change', () => {
          state[p.name] = input.checked;
          onChange();
        });
        row.append(input);
      } else if (p.kind === 'choice') {
        const select = document.createElement('select');
        for (const option of p.options) {
          const item = document.createElement('option');
          item.value = option;
          item.textContent = option;
          select.append(item);
        }
        select.value = p.value;
        select.addEventListener('change', () => {
          state[p.name] = select.value;
          onChange();
        });
        row.append(select);
      } else {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(p.min);
        input.max = String(p.max);
        input.step = String(p.step);
        input.value = String(p.value);

        const out = document.createElement('output');
        out.textContent = String(p.value);

        input.addEventListener('input', () => {
          state[p.name] = Number(input.value);
          out.textContent = input.value;
          onChange();
        });
        row.append(input, out);
      }

      host.append(row);
    }
  }

  return {
    number: (name) => Number(state[name] ?? 0),
    toggle: (name) => state[name] === true,
    choice: (name) => String(state[name] ?? '')
  };
}

/** Replaces the reported figures; each entry is a value and what it counts. */
export function reportCounts(entries: readonly (readonly [number | string, string])[]): void {
  const stats = document.getElementById('stats');
  if (!stats) return;
  stats.replaceChildren();
  for (const [value, text] of entries) {
    const strong = document.createElement('b');
    strong.textContent = String(value);
    stats.append(strong, ` ${text}`, document.createElement('br'));
  }
}
