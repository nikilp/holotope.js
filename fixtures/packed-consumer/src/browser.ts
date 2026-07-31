/**
 * Browser entry point.
 *
 * Imports the same scenario construction and the public Three adapter, so the
 * production build proves the published dependency graph bundles. It renders
 * nothing: a WebGL context is not what is under test here.
 */
import { Scene } from 'three';
import { buildScenario, buildSection, buildSurface } from './scenario.js';

const scenario = buildScenario(2);
const scene = new Scene();
scene.add(buildSection(scenario).object);
scene.add(buildSurface(scenario).object);

const app = document.querySelector('#app');
if (app !== null) {
  app.textContent = `bundled ${scene.children.length} Holotope render products`;
}
