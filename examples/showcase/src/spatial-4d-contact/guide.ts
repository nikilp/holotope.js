/**
 * The guided exploration: five short stages beside the free controls, each
 * with one thing to predict or observe, and actions that say what they touch.
 *
 * Three kinds of action, and the page keeps them apart:
 * - `view`  — moves the observer only: the knife, the projection toggle. The
 *              physical state is untouched, bitwise.
 * - `time`  — changes SIMULATION TIME: selecting a preset (a fresh launch),
 *              replaying, stepping, or jumping to a fixed step count. Every
 *              jump is deterministic stepping from launch, never a posed body.
 * - `study` — opens or closes the rotation study, a separate prescribed
 *              scene; the collision keeps its state meanwhile.
 *
 * The data here is what the page renders; `main.ts` binds each action id to
 * the same functions the free controls call.
 */

export type ActionKind = 'view' | 'time' | 'study';

export interface GuideAction {
  readonly id: string;
  readonly label: string;
  readonly kind: ActionKind;
}

export interface GuideStage {
  readonly id: 'familiar' | 'hold' | 'context' | 'return' | 'offcentre';
  readonly title: string;
  readonly text: string;
  /** The one prediction or observation for this stage. */
  readonly ask: string;
  readonly actions: readonly GuideAction[];
}

export const KIND_LABEL: Record<ActionKind, string> = {
  view: 'view only',
  time: 'changes simulation time',
  study: 'separate scene; the collision keeps its state'
};

export const GUIDE: readonly GuideStage[] = [
  {
    id: 'familiar',
    title: 'A. A familiar collision',
    text: 'Preset A with the knife turned to 90°. This section is the hyperplane x = 0. Both bodies’ centres lie in '
      + 'this section, so the cut passes through the middle of each. Their 4D bodies extend beyond it. That is why the '
      + 'collision looks like an ordinary one: the ball comes in along w, strikes the box, both move. Masses 1 and 2, '
      + 'restitution 1.',
    ask: 'Before Play: after the hit, which body moves faster, and in which direction does each go?',
    actions: [
      { id: 'preset-a', label: 'Select preset A and reset the clock', kind: 'time' },
      { id: 'knife-90', label: 'Turn the knife to 90°', kind: 'view' },
      { id: 'play', label: 'Play', kind: 'time' }
    ]
  },
  {
    id: 'hold',
    title: 'B. Hold the event; move the section',
    text: 'Jump to the first touch — the simulation replayed from launch to a fixed number of steps — then step '
      + 'through the impact one fixed step at a time. While paused, slide the section offset. The bodies leave the cut '
      + 'as the section moves; the world does not change, and the readout’s positions and velocities stand still.',
    ask: 'Observe: slide the offset until both bodies are gone from the cut, and check that no velocity in the readout changed.',
    actions: [
      { id: 'jump-touch', label: 'Jump to the first touch', kind: 'time' },
      { id: 'step-back', label: 'Step −1 (replay to the previous step)', kind: 'time' },
      { id: 'step', label: 'Step +1', kind: 'time' },
      { id: 'offset-hint', label: 'Now slide the Section offset', kind: 'view' }
    ]
  },
  {
    id: 'context',
    title: 'C. Reveal the context',
    text: 'Did the objects disappear, or did this section stop intersecting them? The projection shows the whole '
      + 'objects flattened into this chart: the box’s edges and the ball’s extent are still there wherever the knife '
      + 'is. Overlap in the projection is not contact — the readout gives the true gap along the contact normal.',
    ask: 'Predict: with the projection on, where will the ball’s faint circles be relative to the box’s faint edges?',
    actions: [
      { id: 'context-on', label: 'Show projection context', kind: 'view' }
    ]
  },
  {
    id: 'return',
    title: 'D. Back to the puzzling view',
    text: 'Turn the knife back to the reference, w = 0, and replay preset A. In this cut the ball never appears — its '
      + 'centre never comes closer than 1.5 to the knife, its surface never closer than 1.0 — yet the box is struck '
      + 'and, a little later, leaves the cut. You now '
      + 'know where the cause is: turn the knife, or show the projection. The knife is never turned for you: changing '
      + 'the observer is your act; changing the world is the simulation’s.',
    ask: 'Predict: at what time will the box leave the cut? (It is struck at 0.61 s and then moves at 4/3 along w.)',
    actions: [
      { id: 'knife-0', label: 'Turn the knife back to 0°', kind: 'view' },
      { id: 'replay-a', label: 'Replay preset A from launch', kind: 'time' }
    ]
  },
  {
    id: 'offcentre',
    title: 'E. The turning, then the off-centre collision',
    text: 'First, the rotation study: a prescribed turn of the same box — no collision, no translation, fixed section '
      + '— in the x–y plane and then in the x–w plane. Then preset B. Here the turn is no longer prescribed: the '
      + 'collision produces it, and the body also translates along w. The reference section has a short viewing '
      + 'window, about 1.3 s after the impact, before the box leaves it (the ball is never in it); the projected context shows the motion '
      + 'beyond that window. Describe the two separately: the SECTION widens and narrows as the box turns through the '
      + 'cut; the SOURCE box turns rigidly in x–w and moves along w.',
    ask: 'Predict: which way does the box’s section lean first after the impact, and what happens to its width over the next second?',
    actions: [
      { id: 'study-open', label: 'Open the rotation study', kind: 'study' },
      { id: 'preset-b', label: 'Select preset B and reset the clock', kind: 'time' },
      { id: 'jump-after', label: 'Jump to just after the impact', kind: 'time' },
      { id: 'step', label: 'Step +1', kind: 'time' }
    ]
  }
];

export function actionLabel(action: GuideAction): string {
  return `${action.label} (${KIND_LABEL[action.kind]})`;
}
