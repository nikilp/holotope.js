export {
  integerRing,
  sqrt2Ring,
  phiRing,
  type ExactRing,
  type ExactRingKind,
  type ExactValue
} from './exact.js';
export {
  createCoxeterDiagram,
  coxeterI2,
  coxeterA3,
  coxeterB3,
  coxeterH3,
  coxeterA4,
  coxeterB4,
  coxeterD4,
  coxeterF4,
  coxeterH4,
  type CoxeterDiagram
} from './diagram.js';
export {
  enumerateCoxeterAction,
  orbitDistanceTuples,
  reflectDistances,
  wythoffSeed,
  type CoxeterAction
} from './action.js';
export { CoxeterRealization, realizeOrbit } from './realization.js';
export { createWythoffPolytope, type WythoffOptions } from './wythoff.js';
