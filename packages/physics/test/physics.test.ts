import { describe, expect, it } from 'vitest';
import {
  BivectorN,
  MatN,
  ObjectN,
  Rotor4,
  SceneN,
  TransformN,
  VecN,
  create120Cell,
  create24Cell,
  create600Cell,
  createCrossPolytope,
  createHypercube,
  createSimplex,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBody4,
  RigidBodyObject4Binding,
  inverseRotateBivector4,
  massPropertiesFromCellComplex4,
  rebasePositionsToPrincipalFrame4,
  rotateBivector4
} from '../src/index.js';

function expectMatrixClose(actual: MatN, expected: MatN, digits = 11): void {
  for (let index = 0; index < actual.data.length; index++) {
    expect(actual.data[index]!).toBeCloseTo(expected.data[index]!, digits);
  }
}

function expectIsotropic(values: ArrayLike<number>, tolerance = 1e-14): void {
  const entries = Array.from(values);
  const scale = Math.max(...entries.map(Math.abs));
  expect((Math.max(...entries) - Math.min(...entries)) / scale).toBeLessThan(tolerance);
}

describe('4D bivector frame changes', () => {
  it('rotates plane generators by the induced exterior-square action', () => {
    const plane01 = BivectorN.fromPlanes(4, [{ i: 0, j: 1, angle: 1 }]);
    const rotation = Rotor4.fromPlane(0, 2, Math.PI / 2);
    const rotated = rotateBivector4(plane01, rotation);

    expect(rotated.get(1, 2)).toBeCloseTo(-1, 14);
    for (const component of [0, 1, 2, 4, 5]) {
      expect(Math.abs(rotated.coeffs[component]!)).toBeLessThan(1e-14);
    }
    const recovered = inverseRotateBivector4(rotated, rotation);
    for (let component = 0; component < 6; component++) {
      expect(recovered.coeffs[component]!).toBeCloseTo(plane01.coeffs[component]!, 14);
    }
  });
});

describe('4D mass properties', () => {
  it('matches the closed form for a translated uniform tesseract', () => {
    const tesseract = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 1 }));
    const translation = [10, -3, 2, 0.5];
    for (let vertex = 0; vertex < tesseract.vertexCount; vertex++) {
      for (let axis = 0; axis < 4; axis++) {
        tesseract.positions[vertex * 4 + axis]! += translation[axis]!;
      }
    }
    const properties = massPropertiesFromCellComplex4(tesseract, { density: 3 });

    expect(properties.volume).toBeCloseTo(1, 13);
    expect(properties.mass).toBeCloseTo(3, 13);
    for (let axis = 0; axis < 4; axis++) {
      expect(properties.centerOfMass.data[axis]!).toBeCloseTo(translation[axis]!, 13);
      expect(properties.covarianceAtCenter.get(axis, axis)).toBeCloseTo(3 / 12, 12);
      for (let other = 0; other < 4; other++) {
        if (other !== axis) {
          expect(Math.abs(properties.covarianceAtCenter.get(axis, other))).toBeLessThan(1e-13);
        }
      }
    }
    for (const inertia of properties.inertiaDiagonal) {
      expect(inertia).toBeCloseTo(3 / 6, 12);
    }
    expect(properties.principalAxes.orthogonalityError()).toBeLessThan(1e-13);
    expect(properties.principalAxes.determinant()).toBeCloseTo(1, 12);
  });

  it('recovers isotropic inertia for all six regular convex polychora', () => {
    const regular = [
      createSimplex({ dim: 4 }),
      tetrahedralizeCuboidCells(createHypercube({ dim: 4 })),
      createCrossPolytope({ dim: 4 }),
      create24Cell(),
      create120Cell(),
      create600Cell()
    ];
    for (const complex of regular) {
      const properties = massPropertiesFromCellComplex4(complex);
      expect(properties.volume).toBeGreaterThan(0);
      expect(properties.mass).toBeCloseTo(properties.volume, 12);
      expectIsotropic(properties.inertiaDiagonal);
    }
  });

  it('rebases source geometry into the principal body frame without changing its pose', () => {
    const geometry = tetrahedralizeCuboidCells(createHypercube({ dim: 4 }));
    const sourceRotation = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.7 },
      { i: 1, j: 3, angle: -0.4 }
    ]);
    const sourceMatrix = sourceRotation.toMatrix();
    const scales = [1, 2, 3, 4];
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      const point = new VecN(4);
      for (let axis = 0; axis < 4; axis++) {
        point.data[axis] = geometry.positions[vertex * 4 + axis]! * scales[axis]!;
      }
      const transformed = sourceMatrix.applyTo(point);
      geometry.positions.set(transformed.data, vertex * 4);
    }

    const properties = massPropertiesFromCellComplex4(geometry);
    const principalPositions = rebasePositionsToPrincipalFrame4(
      geometry.positions,
      properties
    );
    const body = RigidBody4.fromMassProperties(properties);
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      const principal = new VecN(principalPositions.subarray(vertex * 4, vertex * 4 + 4));
      const reconstructed = body.rotation.applyToPoint(principal).add(body.position);
      for (let axis = 0; axis < 4; axis++) {
        expect(reconstructed.data[axis]!).toBeCloseTo(
          geometry.positions[vertex * 4 + axis]!,
          11
        );
      }
    }
  });

  it('rejects non-tetrahedral and wrong-dimensional boundaries', () => {
    expect(() => massPropertiesFromCellComplex4(createHypercube({ dim: 4 }))).toThrow(
      /tetrahedral/
    );
    expect(() =>
      massPropertiesFromCellComplex4(tetrahedralizeCuboidCells(createHypercube({ dim: 3 })))
    ).toThrow(/dimension 4/);
  });
});

describe('momentum-primary ballistic dynamics', () => {
  it('keeps world angular momentum exact and integrates the kernel plane convention', () => {
    const angularVelocity = BivectorN.fromPlanes(4, [{ i: 0, j: 1, angle: 1.25 }]);
    const body = new RigidBody4({ mass: 1, inertiaDiagonal: new Float64Array(6).fill(2) })
      .setAngularVelocityWorld(angularVelocity);
    const initialMomentum = body.angularMomentumWorld.coeffs.slice();
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);

    for (let step = 0; step < 10_000; step++) world.step(0.0001);

    expect(body.angularMomentumWorld.coeffs).toEqual(initialMomentum);
    // liveness: the rotor is asserted equal to a specific 1.25 rad rotation,
    // not merely valid, so a world that never integrated leaves identity here.
    expectMatrixClose(
      body.rotation.toMatrix(),
      Rotor4.fromPlane(0, 1, 1.25).toMatrix(),
      10
    );
    expect(body.rotation.toMatrix().orthogonalityError()).toBeLessThan(1e-13);
  });

  it('uses semi-implicit translation and holds forces across substeps', () => {
    const body = new RigidBody4({ mass: 2, inertiaDiagonal: new Float64Array(6).fill(1) });
    body.applyForce([4, 0, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, -10, 0, 0] }).addBody(body);

    world.step(0.1, 5);

    expect(body.linearVelocity.data[0]).toBeCloseTo(0.2, 14);
    expect(body.linearVelocity.data[1]).toBeCloseTo(-1, 14);
    expect(body.position.data[0]).toBeCloseTo(0.012, 14);
    expect(body.position.data[1]).toBeCloseTo(-0.06, 14);
    expect(Array.from(body.force.data)).toEqual([0, 0, 0, 0]);
  });

  it('preserves motion confined to the embedded 3D subalgebra', () => {
    const body = new RigidBody4({
      mass: 1,
      inertiaDiagonal: [2, 3, 5, 4, 6, 7],
      angularMomentumWorld: [0.4, -0.7, 0, 1.1, 0, 0]
    });
    const initialMomentum = body.angularMomentumWorld.coeffs.slice();
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);

    const initialRotation = body.rotation.toMatrix();

    for (let step = 0; step < 2000; step++) world.step(1 / 240);

    expect(body.angularMomentumWorld.coeffs).toEqual(initialMomentum);
    const velocity = body.angularVelocityWorld().coeffs;
    // Planes touching the fourth axis: (0,3), (1,3), (2,3) in the coefficient
    // ordering. Confinement means these stay empty.
    for (const component of [2, 4, 5]) {
      expect(Math.abs(velocity[component]!)).toBeLessThan(1e-12);
    }
    // liveness: in-subalgebra angular velocity ~0.34 and a rotor that turns
    // nearly maximally, against out-of-subalgebra components below 1e-12.
    //
    // Confinement is a claim about where motion is *absent*, and a
    // body that never moved satisfies it everywhere — as would an inert
    // `step`, since the momentum this state is derived from is unchanged by
    // construction and the identity rotation has an empty fourth row. The
    // motion inside the subalgebra has to be witnessed for the absence outside
    // it to carry any weight: the planes that should be turning are turning,
    // eleven orders of magnitude above the ones that should not.
    expect(Math.max(...[0, 1, 3].map((c) => Math.abs(velocity[c]!)))).toBeGreaterThan(0.1);
    let rotationChange = 0;
    const finalRotation = body.rotation.toMatrix();
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        rotationChange = Math.max(
          rotationChange,
          Math.abs(finalRotation.get(row, column) - initialRotation.get(row, column))
        );
      }
    }
    // Measured ~1.99 against a maximum of 2 for an orthogonal matrix entry, so
    // the body genuinely tumbles over the 8.3 s rather than drifting.
    expect(rotationChange).toBeGreaterThan(1);
    const rotation = body.rotation.toMatrix();
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(rotation.get(axis, 3))).toBeLessThan(1e-12);
      expect(Math.abs(rotation.get(3, axis))).toBeLessThan(1e-12);
    }
    expect(rotation.get(3, 3)).toBeCloseTo(1, 12);
  });

  it('keeps anisotropic energy error bounded with second-order timestep scaling', () => {
    const energySpan = (dt: number): number => {
      const body = new RigidBody4({
        mass: 1,
        // Principal second moments [1,2,3,4] produce these physical plane inertias.
        inertiaDiagonal: [3, 4, 5, 5, 6, 7],
        angularMomentumWorld: [0.4, -0.7, 0.2, 1.1, -0.3, 0.5]
      });
      const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);
      const energies: number[] = [];
      const steps = Math.round(20 / dt);
      for (let step = 0; step < steps; step++) {
        world.step(dt);
        energies.push(body.rotationalKineticEnergy());
      }
      return (Math.max(...energies) - Math.min(...energies)) / energies[0]!;
    };

    // liveness: the order ratio is the witness — a scene that stopped moving
    // has zero span at both timesteps, making coarse/fine NaN, which fails.
    const coarse = energySpan(1 / 60);
    const fine = energySpan(1 / 120);
    expect(coarse).toBeLessThan(1e-6);
    expect(coarse / fine).toBeGreaterThan(3.5);
    expect(coarse / fine).toBeLessThan(4.5);
  });

  it('integrates torque into momentum and clears the accumulator', () => {
    const body = new RigidBody4({ mass: 1, inertiaDiagonal: new Float64Array(6).fill(1) });
    body.applyTorque(BivectorN.fromPlanes(4, [{ i: 0, j: 1, angle: 3 }]));
    new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body).step(0.5);
    expect(body.angularMomentumWorld.get(0, 1)).toBeCloseTo(1.5, 14);
    expect(Array.from(body.torque.coeffs)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('treats a zero elapsed-time world step as a complete no-op', () => {
    const body = new RigidBody4({
      mass: 2,
      inertiaDiagonal: [1, 2, 3, 4, 5, 6],
      position: [1, 2, 3, 4],
      linearVelocity: [5, 6, 7, 8]
    });
    body.applyForce([9, 10, 11, 12]);
    body.applyTorque([1, 2, 3, 4, 5, 6]);
    const rotation = body.rotation.toMatrix().data.slice();
    const world = new PhysicsWorld4().addBody(body);

    world.step(0);

    expect(body.position.toArray()).toEqual([1, 2, 3, 4]);
    expect(body.linearVelocity.toArray()).toEqual([5, 6, 7, 8]);
    expect(body.rotation.toMatrix().data).toEqual(rotation);
    expect(body.force.toArray()).toEqual([9, 10, 11, 12]);
    expect(Array.from(body.torque.coeffs)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => world.step(-Number.EPSILON)).toThrow(/non-negative/);
    expect(() => world.step(Number.NaN)).toThrow(/non-negative/);
  });

  it('keeps mass and principal inertia internally consistent at runtime', () => {
    const body = new RigidBody4({ mass: 2, inertiaDiagonal: [1, 2, 3, 4, 5, 6] });

    expect(Reflect.set(body, 'mass', 999)).toBe(false);
    expect(Reflect.set(body, 'invMass', 999)).toBe(false);
    const inertia = body.inertiaDiagonal;
    const inverse = body.invInertiaDiagonal;
    inertia[0] = 999;
    inverse[1] = 999;

    expect(body.mass).toBe(2);
    expect(body.invMass).toBe(0.5);
    expect(Array.from(body.inertiaDiagonal)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(body.invInertiaDiagonal)).toEqual([1, 0.5, 1 / 3, 0.25, 0.2, 1 / 6]);

    body.applyImpulseAtWorldPoint([2, 0, 0, 0], body.position);
    expect(body.linearVelocity.data[0]).toBe(1);
  });
});

describe('simulation to scene synchronization', () => {
  it('interpolates translation and Spin(4) orientation without aliasing body state', () => {
    const body = new RigidBody4({
      mass: 1,
      inertiaDiagonal: new Float64Array(6).fill(1)
    });
    const object = new ObjectN(4);
    const binding = new RigidBodyObject4Binding(body, object);

    body.position.data.set([2, -4, 6, 8]);
    body.rotation = Rotor4.fromPlane(0, 3, Math.PI / 2);
    binding.capture();

    // Mutating the body again cannot alter the captured render snapshots.
    body.position.data.fill(100);
    body.rotation = Rotor4.identity();
    const halfway = binding.poseAt(0.5);
    expect(Array.from(halfway.position.data)).toEqual([1, -2, 3, 4]);
    expectMatrixClose(
      (halfway.rotation as Rotor4).toMatrix(),
      Rotor4.fromPlane(0, 3, Math.PI / 4).toMatrix()
    );

    binding.apply(0.5);
    object.updateWorld();
    expect(Array.from(object.world.position.data)).toEqual([1, -2, 3, 4]);
  });

  it('converts a world body pose into a parent-relative local pose', () => {
    const root = new SceneN(
      4,
      new TransformN(
        4,
        Rotor4.fromPlane(1, 3, 0.45),
        new VecN([3, -2, 1, 0.5])
      )
    );
    const object = new ObjectN(4);
    root.add(object);
    root.updateWorld();

    const body = new RigidBody4({
      mass: 1,
      inertiaDiagonal: new Float64Array(6).fill(1),
      position: [-1, 4, 2, 3],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 2, angle: 0.7 },
        { i: 1, j: 3, angle: -0.3 }
      ])
    });
    const binding = new RigidBodyObject4Binding(body, object);
    binding.apply();
    root.updateWorld();

    for (let axis = 0; axis < 4; axis++) {
      expect(object.world.position.data[axis]!).toBeCloseTo(
        body.position.data[axis]!,
        13
      );
    }
    expectMatrixClose(
      (object.world.rotation as Rotor4).toMatrix(),
      body.rotation.toMatrix()
    );
  });

  it('snaps teleports and rejects invalid interpolation or dimensions', () => {
    const body = new RigidBody4({
      mass: 1,
      inertiaDiagonal: new Float64Array(6).fill(1)
    });
    expect(() => new RigidBodyObject4Binding(body, new ObjectN(3))).toThrow(/4D/);

    const binding = new RigidBodyObject4Binding(body, new ObjectN(4));
    body.position.data.set([9, 8, 7, 6]);
    binding.snap();
    expect(Array.from(binding.poseAt(0).position.data)).toEqual([9, 8, 7, 6]);
    expect(() => binding.poseAt(-0.1)).toThrow(/\[0, 1\]/);
    expect(() => binding.poseAt(Number.NaN)).toThrow(/\[0, 1\]/);
  });
});
