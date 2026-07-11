import type { DragRotation4D } from '@holotope/three';

/**
 * Shared responsive chrome for the showcase pages.
 *
 * On narrow screens the fixed top-right controls panel becomes a
 * collapsible bottom sheet behind a "controls" chip, and the HUD keeps
 * only its headline (lines marked `.detail` hide). On touch devices a
 * round "4D" button appears: while active, every one-finger drag rotates
 * through the hidden dimension (DragRotation4D with modifier 'none')
 * instead of orbiting — phones have no Alt key. Pages should disable
 * their OrbitControls while `drag4d.modifier === 'none'`.
 */
export function setupShowcaseUI(options: { drag4d?: DragRotation4D } = {}): void {
  const style = document.createElement('style');
  style.textContent = /* css */ `
    .ui-explain {
      position: fixed;
      bottom: 14px;
      left: 14px;
      z-index: 12;
      padding: 7px 14px;
      background: rgba(16, 18, 30, 0.92);
      border: 1px solid #26304a;
      border-radius: 999px;
      color: #7fd4ff;
      font: 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .ui-explain:hover {
      border-color: #7fd4ff;
    }
    .ui-explain-panel {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(4, 5, 10, 0.72);
      padding: 20px;
    }
    .ui-explain-panel.open {
      display: flex;
    }
    .ui-explain-card {
      max-width: 620px;
      max-height: 80vh;
      overflow-y: auto;
      padding: 26px 30px;
      background: #10121e;
      border: 1px solid #26304a;
      border-radius: 12px;
      color: #a9bbdd;
      font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ui-explain-card h2 {
      margin: 0 0 10px;
      color: #d7e3ff;
      font-size: 17px;
    }
    .ui-explain-card h3 {
      margin: 18px 0 4px;
      color: #7fd4ff;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .ui-explain-card p {
      margin: 6px 0;
    }
    .ui-explain-card strong {
      color: #d7e3ff;
    }
    .ui-explain-close {
      margin-top: 16px;
      padding: 6px 16px;
      background: #17203a;
      border: 1px solid #26304a;
      border-radius: 6px;
      color: #d7e3ff;
      font: inherit;
      cursor: pointer;
    }
    .ui-toggle {
      display: none;
      position: fixed;
      top: 10px;
      right: 12px;
      z-index: 12;
      padding: 7px 14px;
      background: rgba(16, 18, 30, 0.92);
      border: 1px solid #26304a;
      border-radius: 999px;
      color: #d7e3ff;
      font: 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .ui-4d {
      display: none;
      position: fixed;
      right: 14px;
      bottom: calc(18px + env(safe-area-inset-bottom));
      z-index: 10;
      width: 54px;
      height: 54px;
      align-items: center;
      justify-content: center;
      background: rgba(16, 18, 30, 0.92);
      border: 1px solid #26304a;
      border-radius: 50%;
      color: #8fa3c8;
      font: 700 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .ui-4d.active {
      border-color: #7fd4ff;
      color: #0a0a12;
      background: #7fd4ff;
    }
    @media (max-width: 760px) {
      #hud {
        font-size: 11px;
        line-height: 1.45;
        right: 110px;
      }
      #hud .detail {
        display: none;
      }
      .ui-toggle {
        display: block;
      }
      #controls {
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: auto;
        max-height: 55vh;
        overflow-y: auto;
        border-radius: 12px 12px 0 0;
        border-bottom: none;
        padding: 14px 18px calc(14px + env(safe-area-inset-bottom));
        z-index: 11;
        transform: translateY(110%);
        transition: transform 0.25s ease;
      }
      body.controls-open #controls {
        transform: translateY(0);
      }
      #controls input[type='range'] {
        height: 28px;
      }
    }
    @media (pointer: coarse) {
      .ui-4d.available {
        display: flex;
      }
    }
  `;
  document.head.appendChild(style);

  const toggle = document.createElement('button');
  toggle.className = 'ui-toggle';
  toggle.textContent = 'controls';
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('controls-open');
    toggle.textContent = open ? 'close' : 'controls';
  });
  document.body.appendChild(toggle);

  // "What am I looking at?" overlay: pages provide the narrative in a
  // <template id="explainer"> so the copy lives beside the page markup.
  const template = document.getElementById('explainer') as HTMLTemplateElement | null;
  if (template) {
    const panel = document.createElement('div');
    panel.className = 'ui-explain-panel';
    const card = document.createElement('div');
    card.className = 'ui-explain-card';
    card.appendChild(template.content.cloneNode(true));
    const close = document.createElement('button');
    close.className = 'ui-explain-close';
    close.textContent = 'got it';
    close.addEventListener('click', () => panel.classList.remove('open'));
    card.appendChild(close);
    panel.appendChild(card);
    panel.addEventListener('click', (e) => {
      if (e.target === panel) panel.classList.remove('open');
    });
    document.body.appendChild(panel);

    const explain = document.createElement('button');
    explain.className = 'ui-explain';
    explain.textContent = '? what am I looking at';
    explain.addEventListener('click', () => panel.classList.add('open'));
    document.body.appendChild(explain);
  }

  const drag4d = options.drag4d;
  if (drag4d) {
    const mode4d = document.createElement('button');
    mode4d.className = 'ui-4d available';
    mode4d.textContent = '4D';
    mode4d.title = 'Toggle: drag rotates in 4D instead of orbiting';
    mode4d.addEventListener('click', () => {
      const activate = drag4d.modifier !== 'none';
      drag4d.modifier = activate ? 'none' : 'alt';
      mode4d.classList.toggle('active', activate);
    });
    document.body.appendChild(mode4d);
  }
}
