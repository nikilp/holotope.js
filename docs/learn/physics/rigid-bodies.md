# Rigid bodies and free flight

Momentum-primary integration of `RigidBody4`, and how a fixed-step simulation is handed to a renderer without making the view authoritative.

## Scene synchronization and fixed-step interpolation

Physics is headless, but `RigidBodyObject4Binding` connects a simulated world
pose to core's renderer-neutral `ObjectN`. The binding deliberately targets the
scene graph rather than three.js: any render adapter that consumes
`ObjectN.world` sees the same result.

```ts
import { ObjectN, SceneN } from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBodyObject4Binding
} from '@holotope/physics';

const scene = new SceneN(4);
const node = new ObjectN(4);
scene.add(node);

const binding = new RigidBodyObject4Binding(body, node);
const fixedDt = 1 / 120;

// After every fixed simulation step:
world.step(fixedDt);
binding.capture();

// Once per rendered frame, with accumulator/fixedDt in [0, 1]:
binding.apply(alpha);
scene.updateWorld();
```

The body pose is authoritative and world-space. For a parented target the
binding computes the corresponding local transform through the parent's
current world transform, so hierarchy composition recovers the simulated pose.
It writes only `node.local`; applications retain the efficient contract of one
root `updateWorld()` traversal per rendered frame. `snap()` resets both stored
samples after a teleport, avoiding interpolation across a discontinuity.

## Momentum-primary free flight

`RigidBody4` stores world-frame angular momentum as its authoritative angular
state. Every step changes it only through applied torque. Angular velocity is
derived by rotating momentum into the principal body frame, applying the six
inverse inertias, and rotating the result back to the world frame.

`PhysicsWorld4` uses semi-implicit translation and a Lie midpoint orientation
step. The optional velocity-constraint callback runs after forces and torques
change momentum but before pose integration. The midpoint evaluation keeps the
rotor on Spin(4), conserves torque-free world angular momentum by construction,
and gives bounded second-order energy error for anisotropic free flight.

```ts
import { PhysicsWorld4 } from '@holotope/physics';

const world = new PhysicsWorld4({ gravity: [0, -9.81, 0, 0] });
world.addBody(body);

body.applyForce([4, 0, 0, 0]);
body.applyTorque([0.2, 0, 0, 0, 0, 0]);
world.step(1 / 60, 2);
```

Forces and torques are held constant across the requested substeps and cleared
after the outer step. Gravity uses the y-down convention so freezing the fourth
coordinate retains the usual y-up/y-down 3D embedding and its differential
tests.
