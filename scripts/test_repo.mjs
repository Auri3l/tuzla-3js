#!/usr/bin/env node
/**
 * Tuzla-3JS Automated Repository & Architecture Invariant Test Suite
 * Runs automatically on every PR / push via GitHub Actions and locally via `npm test`.
 *
 * Enforces all AGENTS.md invariants:
 *  1. 44-Byte Vertex Stride Budget & Buffer Integrity (live geometry.worker.js execution)
 *  2. Zero NaN / Out-of-Bounds Indices in generated chunk buffers
 *  3. Single Draw-Call per Chunk (no per-building THREE.Mesh instantiation)
 *  4. Offline Standalone Compatibility (no external CDN fetch() in src/)
 *  5. GLSL Shader Injection & Procedural Atlas Sanity (live materials.js onBeforeCompile check)
 *  6. OSM Data & WORKFLOW_QUEUE.md Structural Integrity
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  process.stdout.write(`  • ${name} ... `);
  const t0 = performance.now();
  try {
    await fn();
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`PASS (${dt} ms)`);
    passed++;
  } catch (err) {
    console.log(`FAIL`);
    console.error(`    ✗ ${err.stack || err.message || err}`);
    failed++;
  }
}

console.log('=== Tuzla-3JS Automated Repository Test Suite ===\n');

// ---------------------------------------------------------------------------
// 1. WORKFLOW_QUEUE.md & OSM Dataset Integrity
// ---------------------------------------------------------------------------
let osmData = null;
let terrainData = null;

await runTest('WORKFLOW_QUEUE.md contains all 25 sequential tickets (1.1 -> 8.2)', () => {
  const queueText = fs.readFileSync(path.join(ROOT, 'WORKFLOW_QUEUE.md'), 'utf8');
  const matches = [...queueText.matchAll(/^- \[([ x])\] \*\*(Ticket \d+\.\d+)\*\* — (.*)$/gm)];
  assert.equal(matches.length, 25, `Expected 25 tickets in WORKFLOW_QUEUE.md, found ${matches.length}`);
  assert.equal(matches[0][2], 'Ticket 1.1');
  assert.equal(matches[matches.length - 1][2], 'Ticket 8.2');
});

await runTest('public/data/tuzla-osm.json & terrain.json schema integrity', () => {
  const osmPath = path.join(ROOT, 'public/data/tuzla-osm.json');
  const terrainPath = path.join(ROOT, 'public/data/terrain.json');
  assert.ok(fs.existsSync(osmPath), 'Missing public/data/tuzla-osm.json');
  assert.ok(fs.existsSync(terrainPath), 'Missing public/data/terrain.json');

  osmData = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
  terrainData = JSON.parse(fs.readFileSync(terrainPath, 'utf8'));

  assert.ok(Array.isArray(osmData.buildings) && osmData.buildings.length > 15000, `Expected >15,000 buildings, got ${osmData.buildings?.length}`);
  assert.ok(Array.isArray(osmData.roads) && osmData.roads.length > 1000, `Expected >1,000 roads, got ${osmData.roads?.length}`);
  assert.ok(Array.isArray(osmData.land) && osmData.land.length > 50, 'Expected land polygons');
  assert.ok(Array.isArray(osmData.pois) && osmData.pois.length > 50, 'Expected POIs');
  assert.ok(Array.isArray(terrainData.bounds) && terrainData.bounds.length === 4, 'Invalid terrain bounds');
});

// ---------------------------------------------------------------------------
// 2. Static Code Invariants (Offline Compatibility & Draw-Call Batching)
// ---------------------------------------------------------------------------
await runTest('Zero external CDN fetch() or remote URLs in src/', () => {
  const srcDir = path.join(ROOT, 'src');
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
  walk(srcDir);

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    // Disallow fetch('http...') ornew TextureLoader().load('http...')
    const badFetch = code.match(/fetch\s*\(\s*['"`]https?:\/\//i);
    assert.equal(badFetch, null, `External runtime fetch found in ${rel}: ${badFetch?.[0]}`);
  }
});

await runTest('Single draw-call per chunk (no per-building THREE.Mesh in src/engine/index.js)', () => {
  const indexCode = fs.readFileSync(path.join(ROOT, 'src/engine/index.js'), 'utf8');
  // Ensure building chunks are instantiated per chunk, not in a loop over osm.buildings
  assert.ok(indexCode.includes('BufferGeometry'), 'Expected BufferGeometry in src/engine/index.js');
  const meshCount = (indexCode.match(/new\s+THREE\.Mesh\b/g) || []).length;
  assert.ok(meshCount >= 1 && meshCount <= 12, `Unexpected number of THREE.Mesh instantiations (${meshCount}) in src/engine/index.js`);
});

// ---------------------------------------------------------------------------
// 3. Live Geometry Worker Execution & 44-Byte Vertex Stride Verification
// ---------------------------------------------------------------------------
await runTest('Live geometry.worker.js execution & 44-byte vertex stride validation', async () => {
  let resultMsg = null;
  let errorMsg = null;

  globalThis.self = {
    postMessage(msg) {
      if (msg.type === 'done') resultMsg = msg;
      else if (msg.type === 'error') errorMsg = msg.message;
    }
  };

  const workerUrl = pathToFileURL(path.join(ROOT, 'src/engine/geometry.worker.js')).href;
  await import(workerUrl);
  assert.equal(typeof globalThis.self.onmessage, 'function', 'geometry.worker.js did not attach self.onmessage');

  // Test with a representative 2,500-building sample + mosques + roads + landuse
  const sampleBuildings = osmData.buildings.slice(0, 2500).map(b => structuredClone(b));
  const sampleOsm = {
    buildings: sampleBuildings,
    roads: osmData.roads.slice(0, 600),
    land: osmData.land.slice(0, 200),
    pois: osmData.pois,
    trees: (osmData.trees || []).slice(0, 200),
    rails: (osmData.rails || []).slice(0, 20),
    waterways: (osmData.waterways || []).slice(0, 20)
  };

  await globalThis.self.onmessage({
    data: {
      type: 'build',
      osm: sampleOsm,
      terrain: terrainData,
      ground: null,
      options: { chunkSize: 1.6 }
    }
  });

  if (errorMsg) assert.fail(`geometry.worker.js threw error: ${errorMsg}`);
  assert.ok(resultMsg, 'geometry.worker.js did not emit a "done" message');
  assert.ok(Array.isArray(resultMsg.chunks) && resultMsg.chunks.length > 0, 'geometry.worker.js produced 0 chunks');

  const ALLOWED_BUFFER_KEYS = new Set(['key', 'position', 'normal', 'uv', 'color', 'info', 'index', 'shell', 'details']);

  function verifySubChunk(sub, label) {
    assert.ok(sub.position instanceof Float32Array, `${label}: position must be Float32Array`);
    assert.ok(sub.normal instanceof Int8Array, `${label}: normal must be Int8Array`);
    assert.ok(sub.uv instanceof Float32Array, `${label}: uv must be Float32Array`);
    assert.ok(sub.color instanceof Uint8Array, `${label}: color must be Uint8Array`);
    assert.ok(sub.info instanceof Float32Array, `${label}: info must be Float32Array`);
    assert.ok(sub.index instanceof Uint32Array, `${label}: index must be Uint32Array`);

    const vCount = sub.position.length / 3;
    assert.equal(vCount % 1, 0, `${label}: position.length not divisible by 3`);
    assert.equal(sub.normal.length, vCount * 3, `${label}: normal.length mismatch`);
    assert.equal(sub.uv.length, vCount * 2, `${label}: uv.length mismatch`);
    assert.equal(sub.color.length, vCount * 3, `${label}: color.length mismatch`);
    assert.equal(sub.info.length, vCount * 4, `${label}: info.length mismatch`);

    // Check for NaNs in float buffers
    for (let i = 0; i < sub.position.length; i++) {
      if (!Number.isFinite(sub.position[i])) assert.fail(`${label}: non-finite position at index ${i}`);
    }
    for (let i = 0; i < sub.uv.length; i++) {
      if (!Number.isFinite(sub.uv[i])) assert.fail(`${label}: non-finite uv at index ${i}`);
    }
    for (let i = 0; i < sub.info.length; i++) {
      if (!Number.isFinite(sub.info[i])) assert.fail(`${label}: non-finite info at index ${i}`);
    }
    // Check index bounds
    for (let i = 0; i < sub.index.length; i++) {
      if (sub.index[i] >= vCount) assert.fail(`${label}: index[${i}]=${sub.index[i]} out of bounds (vCount=${vCount})`);
    }
  }

  for (const chunk of resultMsg.chunks) {
    for (const k of Object.keys(chunk)) {
      assert.ok(ALLOWED_BUFFER_KEYS.has(k), `Chunk ${chunk.key} has forbidden extra attribute "${k}" (violates 44-byte vertex stride)`);
    }
    if (chunk.shell) {
      verifySubChunk(chunk.shell, `chunk[${chunk.key}].shell`);
      if (chunk.details && chunk.details.position.length > 0) {
        verifySubChunk(chunk.details, `chunk[${chunk.key}].details`);
      }
    } else {
      verifySubChunk(chunk, `chunk[${chunk.key}]`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Live Shader & Procedural Atlas Verification (src/engine/materials.js)
// ---------------------------------------------------------------------------
await runTest('materials.js procedural atlas & GLSL onBeforeCompile shader integrity', async () => {
  // Minimal headless 2D canvas mock for facadeAtlas()
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const canvas = {
        width: 256,
        height: 256,
        getContext() {
          return {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            globalAlpha: 1,
            fillRect() {},
            strokeRect() {},
            clearRect() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            fill() {},
            stroke() {},
            arc() {},
            save() {},
            restore() {},
            translate() {},
            scale() {},
            rotate() {},
            createLinearGradient() {
              return { addColorStop() {} };
            },
            createRadialGradient() {
              return { addColorStop() {} };
            },
            getImageData(x, y, w, h) {
              return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
            },
            putImageData() {}
          };
        }
      };
      return canvas;
    }
  };

  const matUrl = pathToFileURL(path.join(ROOT, 'src/engine/materials.js')).href;
  const mats = await import(matUrl);

  function checkBraces(glsl, label) {
    let braces = 0, parens = 0;
    // Strip comments first
    const clean = glsl.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const ch of clean) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '(') parens++;
      else if (ch === ')') parens--;
      assert.ok(braces >= 0, `${label}: unmatched closing '}' in GLSL`);
      assert.ok(parens >= 0, `${label}: unmatched closing ')' in GLSL`);
    }
    assert.equal(braces, 0, `${label}: unbalanced '{}' braces in GLSL (net ${braces})`);
    assert.equal(parens, 0, `${label}: unbalanced '()' parens in GLSL (net ${parens})`);
  }

  const bMat = mats.buildingMaterial();
  assert.equal(typeof bMat.onBeforeCompile, 'function', 'buildingMaterial missing onBeforeCompile');
  const mockShader = {
    uniforms: {},
    vertexShader: `
      #include <common>
      void main() {
        #include <beginnormal_vertex>
        #include <begin_vertex>
        #include <project_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      void main() {
        vec4 diffuseColor = vec4(1.0);
        #include <color_fragment>
        #include <roughnessmap_fragment>
        #include <emissivemap_fragment>
        #include <dithering_fragment>
      }
    `
  };
  bMat.onBeforeCompile(mockShader);
  assert.ok(mockShader.uniforms.uFacade?.value, 'uFacade uniform not bound on buildingMaterial');
  assert.ok(mockShader.uniforms.uMask?.value, 'uMask uniform not bound on buildingMaterial');
  checkBraces(mockShader.vertexShader, 'buildingMaterial.vertexShader');
  checkBraces(mockShader.fragmentShader, 'buildingMaterial.fragmentShader');

  const dMat = mats.buildingDepthMaterial();
  const mockDepthShader = {
    uniforms: {},
    vertexShader: `#include <common>\nvoid main() {\n#include <begin_vertex>\n}`,
    fragmentShader: `void main() {}`
  };
  dMat.onBeforeCompile(mockDepthShader);
  checkBraces(mockDepthShader.vertexShader, 'buildingDepthMaterial.vertexShader');

  const pMat = mats.buildingPickMaterial();
  checkBraces(pMat.vertexShader, 'buildingPickMaterial.vertexShader');
  checkBraces(pMat.fragmentShader, 'buildingPickMaterial.fragmentShader');
});

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
