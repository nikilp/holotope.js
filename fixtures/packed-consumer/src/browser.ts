/**
 * Browser entry point.
 *
 * Imports the same scenario construction and the public Three adapter, so the
 * production build proves the published dependency graph bundles. It renders
 * nothing: a WebGL context is not what is under test here.
 */
import { Scene } from 'three';
import { createHyperrectangle } from '@holotope/core';
import { buildScenario, buildSection, buildSurface } from './scenario.js';

const scenario = buildScenario(2);
const scene = new Scene();
scene.add(buildSection(scenario).object);
scene.add(buildSurface(scenario).object);

// The orthotope constructor is part of the browser dependency graph too.
const orthotope = createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5, 7] });

const app = document.querySelector('#app');
if (app !== null) {
  app.textContent = `bundled ${scene.children.length} render products and a ${orthotope.vertexCount}-vertex orthotope`;
}
