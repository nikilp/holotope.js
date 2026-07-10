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
