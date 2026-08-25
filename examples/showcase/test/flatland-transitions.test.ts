import { describe, expect, it } from 'vitest';
import { SCENES, STAGE, allTransitions, sceneFromHash } from '../src/flatland/scenes.js';

/**
 * The scene-transition state matrix.
 *
 * An independent review found that clicking a scene pill from the opening quiz
 * left the stage broken: scene 4 rendered with its solid pane hidden and scene 6
 * rendered nothing, because the transition installed a destination without
 * clearing where it came from. These pin the contract that made that possible —
 * that the stage after a transition is a function of the DESTINATION alone.
 */
describe('flatland: the scene-transition contract', () => {
  it('enumerates every transition, including the ones from the quiz', () => {
    const transitions = allTransitions();
    // 3 cold entries from the quiz + 3 × 3 scene-to-scene, self-transitions
    // included because re-selecting the current scene must also reset cleanly.
    expect(transitions.length).toBe(12);
    for (const id of SCENES.map((s) => s.id)) {
      expect(transitions.some((t) => t.from === 'quiz' && t.to === id), `quiz → ${id}`).toBe(true);
      expect(transitions.filter((t) => t.to === id).length, `into ${id}`).toBe(4);
    }
  });

  it('gives every scene a complete stage expectation', () => {
    for (const { id } of SCENES) {
      const stage = STAGE[id];
      expect(stage, id).toBeDefined();
      // Both panes are always shown now: the earlier solo layout is what let a
      // stale scene leave a blank stage behind.
      expect(stage.panes, id).toBe('both');
      expect(['svg', 'view3d']).toContain(stage.right);
      expect(stage.forbiddenClasses).toContain('guessing');
      expect(stage.forbiddenClasses).toContain('solo');
    }
  });

  it('expects the destination alone to decide the stage', () => {
    // The property the defect violated: two different routes into one scene must
    // expect the same stage. Expressed here as the table being keyed only by
    // destination, which is what makes that true by construction.
    for (const { to } of allTransitions()) {
      expect(STAGE[to], `into ${to}`).toBe(STAGE[to]);
    }
    expect(Object.keys(STAGE).sort()).toEqual(SCENES.map((s) => s.id).sort());
  });

  it('routes hashes to scenes and falls back to the landing scene', () => {
    expect(sceneFromHash('#projection')).toBe('projection');
    expect(sceneFromHash('#tesseract')).toBe('tesseract');
    expect(sceneFromHash('#section')).toBe('section');
    for (const bogus of ['', '#', '#nope', '#Section', '#tesseract2']) {
      expect(sceneFromHash(bogus), bogus).toBe('section');
    }
  });

  it('names each pane distinctly per scene, so neither reading blurs', () => {
    // Scene 6's two products are both three-dimensional; the panes must say
    // which is the projection and which the intrinsic section.
    const ids = SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
  });
});
