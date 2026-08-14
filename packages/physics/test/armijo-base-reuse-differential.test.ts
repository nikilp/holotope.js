import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdIncrementalPotentialProblemN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  minimizeXpbdIncrementalPotentialN,
  searchXpbdIncrementalPotentialArmijoN,
  simplexStVenantKirchhoffLawN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdArmijoSearchResultN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepFilterN
} from '../src/index.js';
import {
  searchXpbdIncrementalPotentialArmijoFromBaseN
} from '../src/xpbd-incremental-potential-problem.js';

/**
 * The line search has two entry points and they must be one algorithm.
 *
 * The public entry evaluates the base state itself. The internal one takes a
 * base the caller already holds, which is what lets the minimizer stop paying
 * for a full provider pass per accepted iteration. Everything after that first
 * evaluation is shared code, so the risk is not that the arithmetic differs —
 * it is that some path reaches the shared body with different inputs, or that
 * the extra evaluation was load-bearing for a refusal.
 *
 * These compare the two entries directly across every branch the search can
 * take, then confirm the composed step is unchanged.
 *
 * Values are compared, not object identity: nothing here establishes identity
 * as a contract, and two runs legitimately produce distinct frozen records.
 */

/** Everything a search result can be decided on, flattened for comparison. */
function digestSearch(result: XpbdArmijoSearchResultN): string {
  const exact = (value: number): string => value.toExponential(17);
  const lines: string[] = [
    `status=${result.status}`,
    `directionalDerivative=${exact(result.directionalDerivative)}`,
    `baseObjective=${exact(result.base.objective)}`,
    `baseGradientNorm=${exact(result.base.gradientNorm)}`,
    `baseCoordinates=[${Array.from(result.base.coordinates).map(exact).join(',')}]`,
    `baseGradient=[${Array.from(result.base.gradient).map(exact).join(',')}]`,
    `trials=${result.trials.length}`
  ];
  for (const trial of result.trials) {
    lines.push(
      `  trial ${trial.index} status=${trial.status}` +
      ` step=${exact(trial.stepLength)}` +
      ` bound=${exact(trial.armijoUpperBound)}` +
      ` coords=[${Array.from(trial.coordinates).map(exact).join(',')}]` +
      ` objective=${'objective' in trial ? exact(trial.objective) : '-'}` +
      ` refusal=${'refusal' in trial
        ? `${trial.refusal.lawId}/${trial.refusal.reason}` : '-'}`
    );
  }
  lines.push(`stepFilters=${result.stepFilters.length}`);
  for (const filter of result.stepFilters) {
    const evaluation = filter.evaluation;
    lines.push(
      `  filter ${filter.filterId} status=${evaluation.status}` +
      ` max=${'maximumStepLength' in evaluation
        ? exact(evaluation.maximumStepLength) : '-'}` +
      ` reason=${'reason' in evaluation ? String(evaluation.reason) : '-'}`
    );
  }
  if (result.status === 'accepted') {
    lines.push(`stepLength=${exact(result.stepLength)}`);
    lines.push(`accepted=[${Array.from(result.accepted.coordinates).map(exact).join(',')}]`);
    lines.push(`acceptedObjective=${exact(result.accepted.objective)}`);
    lines.push(`acceptedGradient=[${Array.from(result.accepted.gradient).map(exact).join(',')}]`);
  }
  if (result.status === 'step-filter-refused') {
    lines.push(`reason=${result.reason}`);
    lines.push(`blocking=${result.blockingFilter.filterId}`);
  }
  return lines.join('\n');
}

/** Runs both entry points over the same inputs and requires agreement. */
function bothEntries(options: {
  problem: ReturnType<typeof compileXpbdIncrementalPotentialProblemN>;
  coordinates: Float64Array;
  direction: Float64Array;
  initialStep?: number;
  contractionFactor?: number;
  sufficientDecrease?: number;
  maximumTrials?: number;
}): { reference: XpbdArmijoSearchResultN; reused: XpbdArmijoSearchResultN } {
  const reference = searchXpbdIncrementalPotentialArmijoN(options);
  const reused = searchXpbdIncrementalPotentialArmijoFromBaseN(
    options, options.problem.evaluate(options.coordinates)
  );
  expect(digestSearch(reused)).toBe(digestSearch(reference));
  return { reference, reused };
}

function quadraticProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  stiffness: number
): XpbdConservativeForceProviderN {
  const dimension = particles[0]!.dimension;
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (positionOf) => {
    let potentialEnergy = 0;
    const forces = particles.map((particle) => {
      const position = positionOf(particle);
      potentialEnergy += 0.5 * stiffness * position.lengthSq();
      return position.multiplyScalar(-stiffness);
    });
    return { potentialEnergy, forces };
  };
  return {
    id, dimension, particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt
  };
}

function wellProblem(dimension: number, stiffness = 5): {
  problem: ReturnType<typeof compileXpbdIncrementalPotentialProblemN>;
  coordinates: Float64Array;
  particles: XpbdParticleN[];
} {
  const particles = [
    new XpbdParticleN({
      id: 'p0',
      position: Array.from({ length: dimension }, (_, axis) => 0.7 - 0.11 * axis)
    })
  ];
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension,
    particles,
    predictedPositions: particles.map((p) => p.position.clone()),
    deltaTime: 1 / 120,
    providers: [quadraticProvider('well', particles, stiffness)]
  });
  return {
    problem,
    coordinates: problem.packPositions(particles.map((p) => p.position.clone())),
    particles
  };
}

const descent = (
  problem: ReturnType<typeof compileXpbdIncrementalPotentialProblemN>,
  coordinates: Float64Array
): Float64Array =>
  Float64Array.from(problem.evaluate(coordinates).gradient, (g) => -g);

describe('Armijo base reuse — search entry differential', () => {
  it('agrees on an accepted search', () => {
    const { problem, coordinates } = wellProblem(4);
    const { reference } = bothEntries({
      problem, coordinates, direction: descent(problem, coordinates)
    });
    expect(reference.status).toBe('accepted'); // liveness
    expect(reference.trials.length).toBeGreaterThan(0);
  });

  it('agrees through multi-trial backtracking', () => {
    const { problem, coordinates } = wellProblem(4, 900);
    // A long initial step into a stiff well forces several contractions.
    const { reference } = bothEntries({
      problem, coordinates,
      direction: descent(problem, coordinates),
      initialStep: 64
    });
    expect(reference.trials.length).toBeGreaterThan(2); // liveness
  });

  it('agrees when trials are domain-refused', () => {
    const particles = [new XpbdParticleN({ id: 'p0', position: [0.4] })];
    const provider: XpbdConservativeForceProviderN = {
      id: 'open-domain',
      dimension: 1,
      particles,
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: (positionOf) => {
        const x = positionOf(particles[0]!).data[0]!;
        if (!(x > 0.2)) {
          throw new XpbdPotentialDomainErrorN(
            'open-domain', 'outside-open-domain', 'x must exceed 0.2'
          );
        }
        // The well's minimum sits at the origin, *below* the open boundary, so
        // descent genuinely runs at the closed region rather than away from it.
        return {
          potentialEnergy: 0.5 * x * x,
          forces: [new VecN([-x])]
        };
      }
    };
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1, particles,
      predictedPositions: [new VecN([0.4])],
      deltaTime: 0.1, providers: [provider]
    });
    const coordinates = problem.packPositions([new VecN([0.4])]);
    const gradient = problem.evaluate(coordinates).gradient[0]!;
    expect(gradient).toBeGreaterThan(0); // descent is toward the boundary
    const { reference } = bothEntries({
      problem, coordinates, direction: Float64Array.from([-1]), initialStep: 8
    });
    const refused = reference.trials.filter((t) => t.status === 'domain-refused');
    expect(refused.length).toBeGreaterThan(0); // liveness
  });

  it('agrees when a step filter limits and when it refuses', () => {
    const { problem: base, coordinates, particles } = wellProblem(3);
    void base;

    const limiting: XpbdIncrementalPotentialStepFilterN = {
      id: 'limit',
      dimension: 3,
      particles,
      evaluate: () => ({ status: 'limited', maximumStepLength: 0.017 })
    };
    const refusing: XpbdIncrementalPotentialStepFilterN = {
      id: 'refuse',
      dimension: 3,
      particles,
      evaluate: () => ({ status: 'indeterminate', reason: 'initial-domain-violation' })
    };

    const withFilter = (filter: XpbdIncrementalPotentialStepFilterN) =>
      compileXpbdIncrementalPotentialProblemN({
        dimension: 3, particles,
        predictedPositions: particles.map((p) => p.position.clone()),
        deltaTime: 1 / 120,
        providers: [quadraticProvider('well', particles, 5)],
        stepFilters: [filter]
      });

    const limited = withFilter(limiting);
    const a = bothEntries({
      problem: limited, coordinates,
      direction: descent(limited, coordinates)
    });
    expect(a.reference.status).toBe('accepted');
    expect(a.reference.stepFilters.length).toBe(1); // liveness

    const blocked = withFilter(refusing);
    const b = bothEntries({
      problem: blocked, coordinates,
      direction: descent(blocked, coordinates)
    });
    expect(b.reference.status).toBe('step-filter-refused');
  });

  it('agrees on a non-descent direction', () => {
    const { problem, coordinates } = wellProblem(4);
    const uphill = Float64Array.from(problem.evaluate(coordinates).gradient);
    const { reference } = bothEntries({
      problem, coordinates, direction: uphill
    });
    expect(reference.status).toBe('not-descent');
    expect(reference.trials.length).toBe(0);
  });

  it('agrees across R1 through R7', () => {
    for (let dimension = 1; dimension <= 7; dimension++) {
      const { problem, coordinates } = wellProblem(dimension);
      const { reference } = bothEntries({
        problem, coordinates, direction: descent(problem, coordinates)
      });
      expect(reference.status, `R${dimension}`).toBe('accepted');
    }
  });
});

// --- composed behaviour ------------------------------------------------------

function membrane(rows: number, columns: number, crease: number): {
  complex: CellComplex; group: CellGroup;
} {
  const positions: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push(column * 0.6, row * 0.45, row === 1 ? crease : 0, 0.9);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const at = row * columns + column;
      indices.push(at, at + 1, at + columns);
      indices.push(at + 1, at + columns + 1, at + columns);
    }
  }
  const complex = new CellComplex(4, Float64Array.from(positions), [{
    key: 'membrane', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from(indices)
  }]);
  const [group] = complex.cellsOfDim(2);
  if (group === undefined) throw new Error('membrane: no 2-cells');
  return { complex, group };
}

function floor(tiles: number): { complex: CellComplex; group: CellGroup } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let tile = 0; tile < tiles; tile++) {
    const x = (tile % 4) * 1.1;
    const y = Math.floor(tile / 4) * 1.1;
    positions.push(x, y, 0, 0, x + 0.9, y, 0, 0, x, y + 0.9, 0, 0, x, y, 0.9, 0);
    for (let vertex = 0; vertex < 4; vertex++) indices.push(tile * 4 + vertex);
  }
  const complex = new CellComplex(4, Float64Array.from(positions), [{
    key: 'floor', dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from(indices)
  }]);
  const [group] = complex.cellsOfDim(3);
  if (group === undefined) throw new Error('floor: no 3-cells');
  return { complex, group };
}

function composedScene(id: string, accelerated: boolean) {
  const sheet = membrane(3, 4, 0.35);
  const obstacle = floor(8);
  const binding = compileXpbdParticleBindingN({
    id: `${id}-points`, source: sheet.complex,
    fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0 || sourceVertexIndex === 3
  });
  for (const particle of binding.particles) particle.velocity.data[3] = -1.6;
  const material = compileSimplexConstitutiveFamilyN({
    id: `${id}-stretch`, source: sheet.complex, simplexGroup: sheet.group,
    particles: binding.particles, law: simplexStVenantKirchhoffLawN,
    material: { firstLameParameter: 1.5, shearModulus: 2 }
  });
  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: `${id}-bend`, binding, simplexGroup: sheet.group,
    stiffness: 8, restCoordinate: 1, minimumMeasureRatio: 0.05
  });
  const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${id}-contact`, binding, obstacle: obstacle.complex,
    simplexGroup: obstacle.group, minimumDistance: 0.04,
    activationDistance: 1.2, stiffness: 3,
    maximumDirectionError: 2 ** -12,
    ...(accelerated ? {
      candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: obstacle.complex, simplexGroup: obstacle.group, leafSize: 2
      })
    } : {})
  });
  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  material.addToWorld(world);
  bending.addToWorld(world);
  contact.addToWorld(world);
  return { world, binding, bending, contact, sheet: sheet.complex };
}

describe('Armijo base reuse — composed behaviour', () => {
  it('preserves iteration-limit terminals and rollback', () => {
    const particles = [new XpbdParticleN({ id: 'p0', position: [0.9, 0.4, 0.2] })];
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 3, particles,
      predictedPositions: particles.map((p) => p.position.clone()),
      deltaTime: 1 / 30,
      providers: [quadraticProvider('stiff', particles, 400)]
    });
    const before = particles.map((p) => p.position.toArray());
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: problem.packPositions(
        particles.map((p) => p.position.clone())
      ),
      maximumIterations: 1,
      gradientTolerance: 1e-18
    });
    expect(result.status).toBe('iteration-limit');
    expect(result.iterations.length).toBe(1);
    // Minimization never writes live particles; application is a separate stage.
    expect(particles.map((p) => p.position.toArray())).toEqual(before);
  });

  it('keeps the membrane composition and search-mode equivalence', { timeout: 120_000 }, () => {
    const plain = composedScene('plain', false);
    const fast = composedScene('fast', true);
    const options = {
      deltaTime: 1 / 240,
      warmStart: 'feasible-inertial-prediction' as const,
      minimization: { directionPolicy: 'steepest-descent' as const }
    };
    let sawActive = false;
    for (let step = 0; step < 24; step++) {
      const a = stepXpbdIncrementalPotentialWorldN({
        world: plain.world,
        stepFilters: [plain.bending.stepFilter, plain.contact.stepFilter],
        ...options
      });
      const b = stepXpbdIncrementalPotentialWorldN({
        world: fast.world,
        stepFilters: [fast.bending.stepFilter, fast.contact.stepFilter],
        ...options
      });
      expect(b.step.status, `step ${step}`).toBe(a.step.status);
      expect(b.diagnosis.condition, `step ${step}`).toBe(a.diagnosis.condition);
      expect(b.step.progress.acceptedIterations).toBe(a.step.progress.acceptedIterations);

      const contactA = plain.contact.evaluate();
      const contactB = fast.contact.evaluate();
      expect(contactB.candidateQuery.candidates.map(
        (c) => c.id.split('fast').join('scene')
      )).toEqual(contactA.candidateQuery.candidates.map(
        (c) => c.id.split('plain').join('scene')
      ));
      expect(contactB.potentialEnergy).toBe(contactA.potentialEnergy);
      if (contactA.activeCandidates.length > 0) sawActive = true;
      plain.binding.writeSourcePositions();
      fast.binding.writeSourcePositions();
    }
    expect(sawActive).toBe(true); // liveness
    expect(Array.from(fast.sheet.positions))
      .toEqual(Array.from(plain.sheet.positions));
  });
});
