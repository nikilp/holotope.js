# What a pick may claim

A pick on a render product returns a `RepresentationHitN`. It answers three
independent questions, and they are separate because they are separate facts:

| Question | Field |
| --- | --- |
| which source primitive produced this? | `source` |
| is the lifted point exact on that primitive? | `ambientPointStatus` |
| is that point unique under the map? | `ambiguity` |

Reading only the second is the mistake. A projected pick routinely reports
`ambientPointStatus: 'exact'` while `ambiguity` is `'projection-overlap'`,
because the lift is exact *on the triangle the ray met* and the projection as a
whole is many-to-one. A caller that gates on precision alone will present a
conditional lift as the source point.

## Read the claim, not the fields

`describeRepresentationHitN` performs that reading once and returns a claim:

```ts
import { describeRepresentationHitN } from '@holotope/core';

const report = describeRepresentationHitN(hit);

useSourceCell(report.source); // identity always survives

switch (report.ambient.claim) {
  case 'unique':
    // Exactly one source point produced this observation.
    useSourcePoint(report.ambient.point);
    break;
  case 'on-selected-primitive':
    // Exact on the named primitive, not unique under the map.
    showAgainstPrimitive(report.ambient.point, report.ambient.ambiguity);
    break;
  case 'approximate':
    showApproximate(report.ambient.point);
    break;
  case 'unavailable':
    showIdentityOnly(report.source);
    break;
}
```

The ambient point is reachable only through a branch that already states what
may be claimed of it, so the two fields cannot be combined wrongly. There is
deliberately no separate boolean saying the same thing.

`report.lineageKinds` names the reductions that produced the representation,
which is what makes a refusal explicable rather than asserted.

## What claims which

- An **unprojected affine section** is a chart on its hyperplane: a pick is
  `unique`, and the ambient point's coordinate along the slice normal equals the
  slice offset.
- A **perspective or coordinate projection** is many-to-one: a pick is
  `on-selected-primitive` at best, never `unique`.
