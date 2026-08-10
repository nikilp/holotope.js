/**
 * Reader for {@link StationarityScaleReport}.
 *
 * Deliberately a separate module: every field of that report is consumed here,
 * which is what makes the report evidence rather than decoration. A field
 * nothing reads cannot influence a decision.
 *
 * The table it renders is the whole argument. One scene, one fixed horizon,
 * six timesteps, two stop tests, and a closed-form answer to compare each row
 * against — so a reader can see the delivered velocity leave Newton's answer
 * under one criterion and hold it under the other, without taking anything
 * here on trust.
 */
import type { StationarityScaleReport } from './stationarity-scale-contract.js';

/** Column widths, so the table lines up under a monospaced font. */
const WIDTHS = [10, 7, 10, 11, 6, 16, 11, 16, 11] as const;

const line = (cells: readonly string[]): string =>
  cells.map((cell, index) => cell.padEnd(WIDTHS[index] ?? 0)).join('').trimEnd();

const exp = (value: number): string => value.toExponential(3);

/**
 * Renders one report as the lines a caller would actually log, which is also
 * what makes every reported field load-bearing rather than decorative.
 */
export function summarizeStationarityScale(
  report: StationarityScaleReport
): readonly string[] {
  const last = report.rows[report.rows.length - 1];
  const kinds = report.rows[0];
  if (last === undefined || kinds === undefined) {
    return ['no timestep was driven'];
  }

  const accelerationSteps = report.rows.reduce((sum, row) => sum + row.steps, 0);
  const accelerationApplied = report.rows.reduce(
    (sum, row) => sum + row.accelerationResidual.applied,
    0
  );
  const accelerationWarm = report.rows.reduce(
    (sum, row) => sum + row.accelerationResidual.convergedAtWarmStart,
    0
  );

  return [
    `${report.force} N on ${report.mass} kg over a fixed ${exp(report.horizon)} s ` +
      `horizon; Newton's answer is ${report.newtonVelocity} m/s at every timestep`,
    // The two thresholds are printed with their units, because the units are
    // the entire difference between them.
    `'${kinds.packedGradient.convergenceKind}' at ` +
      `${exp(report.packedTolerance)} mass*length, versus ` +
      `'${kinds.accelerationResidual.convergenceKind}' at ` +
      `${exp(report.accelerationTolerance)} length/time^2`,
    // Analytic, not fitted: the warm-start packed gradient is exactly
    // deltaTime^2 * force, so it crosses the tolerance at a known timestep.
    `the packed test resolves forces down to tolerance / deltaTime^2, so it ` +
      `stops seeing ${report.force} N below deltaTime ` +
      `${exp(report.packedResolutionTimestep)} s`,
    '',
    // `applied` and `warm` belong to the packed-gradient run; the same two
    // counts for the acceleration run are totalled below the table.
    line([
      'deltaTime', 'steps', 'floor N', 'applied', 'warm',
      'v packed', 'err packed', 'v accel', 'err accel'
    ]),
    ...report.rows.map((row) => line([
      exp(row.deltaTime),
      String(row.steps),
      exp(row.resolvableForce),
      // Reported for the packed-gradient run, which is the one that fails.
      `${row.packedGradient.applied}/${row.steps}`,
      String(row.packedGradient.convergedAtWarmStart),
      row.packedGradient.velocity.toFixed(12),
      exp(row.packedGradient.velocityError),
      row.accelerationResidual.velocity.toFixed(12),
      exp(row.accelerationResidual.velocityError)
    ])),
    '',
    // Nothing anywhere reported a problem, which is exactly the point: the
    // base really was stationary to the authored tolerance.
    `every packed-gradient step reported applied; below the floor every one ` +
      `of them converged at its warm start, which is a legitimate outcome and ` +
      `not a refusable one`,
    `at deltaTime ${exp(last.deltaTime)} the warm-start packed gradient is ` +
      `${exp(last.warmStartPackedGradient)}, already under ` +
      `${exp(report.packedTolerance)}`,
    // Dividing that run's own residual by deltaTime^2 recovers the whole
    // applied force as unresolved acceleration: it was never seen, not
    // reduced. The acceleration run's residual is in a different unit and
    // comes from a different drive, so the two are printed apart.
    `it left ${exp(last.packedGradient.finalResidual)} of packed residual — ` +
      `${exp(last.packedGradient.finalResidual / (last.deltaTime * last.deltaTime))} ` +
      `m/s^2 once divided by deltaTime^2, which on ${report.mass} kg is the ` +
      `whole ${report.force} N: unseen, not reduced`,
    `acceleration run: ${accelerationApplied}/${accelerationSteps} applied, ` +
      `${accelerationWarm} converged at a warm start, final residual ` +
      `${exp(last.accelerationResidual.finalResidual)}`,
    // Not a better-or-worse ranking. The two quantities differ by exactly
    // deltaTime^2, so a bound on one is not a bound on the other, and the
    // scene's author is the only party who knows which one the scene needs.
    `the criteria differ by exactly deltaTime^2: 'packed-gradient' holds a ` +
      `per-step position residual, 'maximum-acceleration-residual' holds a ` +
      `force resolution, and neither holds both`,
    `authoring both spellings is refused: ${report.bothSpellingsRefused}`
  ];
}
