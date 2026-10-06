import { describe, expect, it } from 'vitest';
import { createExperience } from '../../src/flatland/journey.js';
import { modelToThree } from '../../src/flatland/picture.js';
import { homeCamera } from '../../src/flatland/stage.js';

/**
 * The home frame holds everything the journey asks you to look at: every
 * corner of the cube, every corner of every cut and every point of every
 * shadow, in every pose and at every place of the slice, at the picture shapes
 * a desktop window and a phone give it. The plane's drawn square may run off
 * the frame; the plane goes on.
 */

/** Picture aspects: a desktop window's, a wide one's, a phone's upright, a short phone's, a phone's sideways, and a sliver. */
const ASPECTS = [716 / 774, 1.9, 283 / 373, 283 / 325, 1.12, 0.55];

describe('the home frame', () => {
  for (const aspect of ASPECTS) {
    it(`holds every corner, cut and shadow at aspect ${aspect.toFixed(2)}`, () => {
      const camera = homeCamera(aspect);
      const x = createExperience('free', { instantTurns: true });
      x.dispatch({ type: 'shadow', on: true });
      let checked = 0;
      let worst = 0;
      for (const rung of ['plane', 'space'] as const) {
        x.dispatch({ type: 'rung', id: rung });
        for (let a = 0; a <= 90; a += 7.5) {
          x.dispatch({ type: 'tip-to', angle: (a * Math.PI) / 180 });
          const reach = x.view().reach;
          for (let h = -reach; h <= reach + 1e-9; h += 0.15) {
            x.dispatch({ type: 'slide-to', offset: h });
            const v = x.view();
            const points = [
              ...v.cut.corners.map((c) => c.at),
              ...v.shadow.points.map((p) => p.at),
              ...(rung === 'plane' ? v.corners.map((c) => c.posed) : [])
            ];
            for (const p of points) {
              const ndc = modelToThree(p).project(camera);
              worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
              checked += 1;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(5000);
      // A margin inside the frame's edge, for the dots' own size.
      expect(worst).toBeLessThan(0.95);
    });
  }
});
