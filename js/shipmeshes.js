// PROCEDURAL SHIP ARCHITECTURE — the visual body of a boarding deck.
//
// No tile GLBs: floors, bulkheads, ceilings, catwalks, ramps and props are all
// generated geometry, merged into ~10 meshes (one per material) like
// buildMergedStatic does for the fantasy tiles. Props are derived FROM the
// colliders the deck generator emits — a box collider IS a crate or a machine,
// a cylinder IS a structural column — so the art and the hitbox are the same
// object and can never disagree.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, PLATFORM_H } from './config.js';
import { makePiece } from './assets.js';

const WALL_H = 7;    // bulkhead height
const CEIL_H = 7;    // deck ceiling

// deterministic per-cell hash for panel variation (no rng needed)
const cellHash = (cx, cy) => {
  let h = (cx * 374761393 + cy * 668265263) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177 >>> 0;
  return (h ^ (h >> 16)) >>> 0;
};

function makeMats(accent, facility = false) {
  if (facility) {
    // training-facility whites: bright composite panels, blue trim
    return {
      floorA: new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.1, roughness: 0.7 }),
      floorB: new THREE.MeshStandardMaterial({ color: 0xbfc8d2, metalness: 0.1, roughness: 0.75 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xe4e9ef, metalness: 0.12, roughness: 0.65 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.35, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0xaab4c0, metalness: 0.2, roughness: 0.8 }),
      crate: new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.1, roughness: 0.8 }),
      machine: new THREE.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 0.3, roughness: 0.6 }),
      accent: new THREE.MeshStandardMaterial({
        color: 0x111111, emissive: new THREE.Color(accent), emissiveIntensity: 1.5,
        metalness: 0, roughness: 1, toneMapped: false,
      }),
      lightPanel: new THREE.MeshStandardMaterial({
        color: 0x222222, emissive: 0xd9ecf6, emissiveIntensity: 1.25, roughness: 1,
      }),
    };
  }
  return {
    floorA: new THREE.MeshStandardMaterial({ color: 0x6c7683, metalness: 0.25, roughness: 0.8 }),
    floorB: new THREE.MeshStandardMaterial({ color: 0x5d6672, metalness: 0.25, roughness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x7b8593, metalness: 0.3, roughness: 0.75 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x4d5560, metalness: 0.4, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3f4750, metalness: 0.3, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x8d8774, metalness: 0.15, roughness: 0.9 }),
    machine: new THREE.MeshStandardMaterial({ color: 0x6b7483, metalness: 0.45, roughness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: new THREE.Color(accent), emissiveIntensity: 1.6,
      metalness: 0, roughness: 1, toneMapped: false,
    }),
    lightPanel: new THREE.MeshStandardMaterial({
      color: 0x222222, emissive: 0xd9ecf6, emissiveIntensity: 1.25, roughness: 1,
    }),
  };
}

export function buildShipStatic(fs) {
  const g = fs.grid;
  const accent = fs.theme?.accent ?? 0xffa63d;
  const mats = makeMats(accent, !!g.facility);
  const buckets = new Map(); // matKey -> geometries[]
  const add = (matKey, geo, x, y, z, rotY = 0) => {
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    if (!buckets.has(matKey)) buckets.set(matKey, []);
    buckets.get(matKey).push(geo);
  };
  const box = (matKey, x, y, z, sx, sy, sz, rotY = 0) =>
    add(matKey, new THREE.BoxGeometry(sx, sy, sz), x, y, z, rotY);

  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) ? 0 : g.cells[cy * g.w + cx];
  const windowSet = new Set((g.windows || []).map(wd => `${wd.cx},${wd.cy},${wd.dx},${wd.dy}`));
  const walkable = (c) => c === 1 || c === 3 || c === 4 || c === 6; // FLOOR/STAIRS/TRAP/RAMP
  const DIRS = [[1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2]];

  // ---- floor plates, ceilings, walls ----
  for (let cy = 0; cy < g.h; cy++) {
    for (let cx = 0; cx < g.w; cx++) {
      const c = at(cx, cy);
      if (!walkable(c) && c !== 5) continue;
      const x = cx * CELL, z = cy * CELL;
      const h = cellHash(cx, cy);

      // deck plate (checker), skipped under ramps (the wedge covers the cell)
      if (c !== 6) {
        box((cx + cy) % 2 ? 'floorA' : 'floorB', x, -0.11, z, CELL, 0.22, CELL);
        if (h % 23 === 0) box('accent', x, 0.011, z, 0.5, 0.012, CELL * 0.9); // guide strip
      }

      // ceiling slab + occasional light panel (open-sky grids skip the roof)
      if (!g.noCeil) {
        box('dark', x, CEIL_H + 0.15, z, CELL, 0.3, CELL);
        if (h % 3 === 0) box('lightPanel', x, CEIL_H - 0.02, z, 2.4, 0.06, 2.4);
      }

      // bulkhead faces toward solid neighbours
      for (const [dx, dy] of DIRS) {
        if (at(cx + dx, cy + dy) !== 0) continue;
        const wx = x + dx * (CELL / 2 + 0.3), wz = z + dy * (CELL / 2 + 0.3);
        const along = dx !== 0; // wall runs along z if the normal is x
        const L = CELL + 0.6;
        if (windowSet.has(`${cx},${cy},${dx},${dy}`)) {
          // VIEWPORT: sill + header + mullions — the gap between shows space
          box('wall', wx, 0.55, wz, along ? 0.6 : L, 1.1, along ? L : 0.6);
          box('dark', wx, 5.8, wz, along ? 0.6 : L, WALL_H - 4.6, along ? L : 0.6);
          const mx = along ? 0 : CELL / 2, mz = along ? CELL / 2 : 0;
          box('frame', wx + mx, WALL_H / 2, wz + mz, 0.4, WALL_H, 0.4);
          box('frame', wx - mx, WALL_H / 2, wz - mz, 0.4, WALL_H, 0.4);
          box('accent', x + dx * (CELL / 2 - 0.02), 1.14, z + dy * (CELL / 2 - 0.02),
            along ? 0.05 : CELL * 0.92, 0.1, along ? CELL * 0.92 : 0.05);
          continue;
        }
        // main panel, two-tone: plated lower half, darker upper
        box('wall', wx, 1.6, wz, along ? 0.6 : L, 3.2, along ? L : 0.6);
        box('dark', wx, 3.2 + (WALL_H - 3.2) / 2, wz, along ? 0.6 : L, WALL_H - 3.2, along ? L : 0.6);
        // accent light strip at eye height — the ship's veins
        box('accent', x + dx * (CELL / 2 - 0.02), 2.6, z + dy * (CELL / 2 - 0.02),
          along ? 0.05 : CELL * 0.92, 0.16, along ? CELL * 0.92 : 0.05);
        // rib columns at the panel seams
        const rx = along ? 0 : CELL / 2, rz = along ? CELL / 2 : 0;
        box('frame', wx + rx, WALL_H / 2, wz + rz, 0.5, WALL_H, 0.5);
        box('frame', wx - rx, WALL_H / 2, wz - rz, 0.5, WALL_H, 0.5);
      }
    }
  }

  // ---- catwalks (elev cells) + railings + ramps ----
  const isElev = (cx, cy) => cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && g.elev[cy * g.w + cx] === 1;
  for (let cy = 0; cy < g.h; cy++) {
    for (let cx = 0; cx < g.w; cx++) {
      if (!isElev(cx, cy)) continue;
      const x = cx * CELL, z = cy * CELL;
      // walkway slab (top at PLATFORM_H — that's what groundHeightAt reports)
      box('machine', x, PLATFORM_H - 0.22, z, CELL, 0.44, CELL);
      box('accent', x, PLATFORM_H - 0.4, z, CELL * 0.9, 0.08, 0.1); // underglow line
      // support columns on alternating cells
      if ((cx + cy) % 2 === 0) box('frame', x, (PLATFORM_H - 0.4) / 2, z, 0.6, PLATFORM_H - 0.4, 0.6);
      // railings along open edges (not toward other elev cells or their ramps)
      for (const [dx, dy] of DIRS) {
        if (isElev(cx + dx, cy + dy)) continue;
        if (at(cx + dx, cy + dy) === 6) continue; // ramp joins here
        const ex = x + dx * (CELL / 2 - 0.1), ez = z + dy * (CELL / 2 - 0.1);
        const along = dx !== 0;
        box('frame', ex, PLATFORM_H + 0.55, ez, along ? 0.1 : CELL, 1.1, along ? CELL : 0.1);
        box('accent', ex, PLATFORM_H + 1.12, ez, along ? 0.09 : CELL, 0.07, along ? CELL : 0.09);
      }
    }
  }
  for (const [idx, r] of g.ramps) {
    const cx = idx % g.w, cy = Math.floor(idx / g.w);
    const x = cx * CELL, z = cy * CELL;
    // a tilted slab whose top follows the walk plane: 0 at the low edge,
    // PLATFORM_H at the high edge (groundHeightAt's s-interpolation)
    const ang = Math.atan2(PLATFORM_H, CELL);
    const len = Math.hypot(PLATFORM_H, CELL) + 0.4;
    const wedge = new THREE.BoxGeometry(CELL, 0.4, len);
    wedge.rotateX(-ang);
    const yaw = Math.atan2(r.dx, r.dy); // slope rises along (dx,dy)
    add('machine', wedge, x, PLATFORM_H / 2 - 0.25, z, yaw);
    const edge = new THREE.BoxGeometry(0.3, 0.35, len);
    edge.rotateX(-ang);
    add('accent', edge.clone().translate(CELL / 2 - 0.15, 0.12, 0), x, PLATFORM_H / 2 - 0.2, z, yaw);
    add('accent', edge.translate(-CELL / 2 + 0.15, 0.12, 0), x, PLATFORM_H / 2 - 0.2, z, yaw);
  }

  // ---- props FROM colliders: crate / machine / column ----
  for (const c of g.colliders || []) {
    if (c.noMesh) continue; // whatever placed it draws its own visual
    const y0 = c.y0 ?? 0, top = c.h ?? 3;
    const hgt = top - y0, ymid = y0 + hgt / 2;
    if (c.hx !== undefined) {
      const w = c.hx * 2, d = c.hz * 2;
      if (hgt <= 2.3 && Math.max(w, d) < 5) {
        // CRATE: body + lid lip + edge frames + a stamped accent tag
        box('crate', c.x, ymid, c.z, w - 0.12, hgt - 0.1, d - 0.12);
        box('frame', c.x, top - 0.09, c.z, w, 0.18, d);
        box('frame', c.x, y0 + 0.09, c.z, w, 0.18, d);
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          box('frame', c.x + sx * (w / 2 - 0.09), ymid, c.z + sz * (d / 2 - 0.09), 0.18, hgt, 0.18);
        }
        if (cellHash(Math.round(c.x), Math.round(c.z)) % 3 === 0) {
          box('accent', c.x + w / 2 - 0.02, ymid, c.z, 0.06, 0.35, 0.35);
        }
      } else {
        // MACHINE / STRUCTURE: main housing + darker base + vents + status strip
        box('machine', c.x, ymid, c.z, w, hgt, d);
        box('dark', c.x, y0 + 0.3, c.z, w + 0.35, 0.6, d + 0.35);
        box('dark', c.x, top - 0.15, c.z, w + 0.2, 0.3, d + 0.2);
        box('accent', c.x, Math.min(top - 0.5, y0 + hgt * 0.7), c.z + d / 2 + 0.02, Math.min(w * 0.7, 3), 0.14, 0.05);
        box('accent', c.x, Math.min(top - 0.5, y0 + hgt * 0.7), c.z - d / 2 - 0.02, Math.min(w * 0.7, 3), 0.14, 0.05);
      }
    } else if (c.r !== undefined) {
      // COLUMN: octagonal trunk + accent ring
      const geo = new THREE.CylinderGeometry(c.r, c.r * 1.12, hgt, 8);
      add('frame', geo, c.x, ymid, c.z);
      const ring = new THREE.CylinderGeometry(c.r + 0.05, c.r + 0.05, 0.16, 8, 1, true);
      add('accent', ring, c.x, Math.min(y0 + hgt - 0.4, 2.6), c.z);
    }
  }

  // ---- the breach (spawn): torn hull + scorch. Not in the bay or on the
  // bridge — those are OUR decks, nobody blew a hole in them ----
  if (g.spawn && !g.bay && !g.bridge) {
    const bx = g.spawn.x, bz = g.spawn.z;
    const scorch = new THREE.CircleGeometry(3.2, 9);
    scorch.rotateX(-Math.PI / 2);
    add('dark', scorch, bx, 0.02, bz);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const shard = new THREE.BoxGeometry(0.5, 2.2 + (i % 3) * 0.8, 1.1);
      shard.rotateZ(0.5 - (i % 3) * 0.4);
      add('frame', shard, bx + Math.cos(a) * 2.6, 0.8, bz + Math.sin(a) * 2.6, a);
    }
    box('accent', bx, 0.03, bz, 1.6, 0.02, 1.6);
  }

  // ---- the lift (stairs): door frame + hazard glow handled by buildFloorMeshes ----
  if (g.stairs && g.stairs.cx >= 0) {
    const sx = g.stairs.x, sz = g.stairs.z;
    const yaw = (g.portal?.yaw ?? 0);
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(0.9, 6.4, 0.9);
      add('machine', col, sx + Math.cos(yaw) * side * 2.1, 3.2, sz + Math.sin(yaw) * side * 2.1);
    }
    const beam = new THREE.BoxGeometry(5.1, 0.7, 0.9);
    add('machine', beam, sx, 6.1, sz, yaw);
    const glowbar = new THREE.BoxGeometry(4.6, 0.14, 0.5);
    add('accent', glowbar, sx, 5.7, sz, yaw);
  }

  // ---- merge: one mesh per material ----
  const group = new THREE.Group();
  for (const [key, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    for (const gg of geos) gg.dispose();
  }

  // deployment doors: glowing frames where the waves come in
  for (const gt of g.gates || []) {
    const gx = gt.x * CELL, gz = gt.y * CELL;
    // which border is this door against?
    const dx = gt.x <= 1 ? -1 : gt.x >= g.w - 2 ? 1 : 0;
    const dy = dx !== 0 ? 0 : (gt.y <= 1 ? -1 : 1);
    const wx = gx + dx * (CELL / 2 - 0.05), wz = gz + dy * (CELL / 2 - 0.05);
    const along = dx !== 0;
    box('accent', wx, 2.9, wz, along ? 0.12 : CELL * 0.9, 0.2, along ? CELL * 0.9 : 0.12);
    for (const sside of [-1, 1]) {
      const px = along ? wx : wx + sside * CELL * 0.45;
      const pz = along ? wz + sside * CELL * 0.45 : wz;
      box('accent', px, 1.5, pz, 0.12, 3.0, 0.12);
    }
  }

  // the bridge: a starfield behind the viewport, and the hologram status wall
  if (g.bridge) {
    const wins = g.windows || [];
    if (wins.length) {
      const xs = wins.map(wd => wd.cx * CELL);
      const x0 = Math.min(...xs) - CELL, x1 = Math.max(...xs) + CELL;
      const zEdge = (wins[0].cy + wins[0].dy) * CELL - wins[0].dy * 1.5;
      const sc = document.createElement('canvas');
      sc.width = 1024; sc.height = 256;
      const sctx = sc.getContext('2d');
      sctx.fillStyle = '#020409';
      sctx.fillRect(0, 0, 1024, 256);
      let sseed = 1234;
      const srand = () => { sseed = (sseed * 16807) % 2147483647; return sseed / 2147483647; };
      for (let i = 0; i < 340; i++) {
        const b = srand();
        sctx.fillStyle = b > 0.94 ? '#bfe6ff' : b > 0.7 ? '#ffffff' : '#7d8ba0';
        const r = b > 0.96 ? 2.2 : b > 0.8 ? 1.4 : 0.8;
        sctx.fillRect(srand() * 1024, srand() * 256, r, r);
      }
      const starTex = new THREE.CanvasTexture(sc);
      starTex.colorSpace = THREE.SRGBColorSpace;
      const stars = new THREE.Mesh(
        new THREE.PlaneGeometry(x1 - x0 + 24, 26),
        new THREE.MeshBasicMaterial({ map: starTex, toneMapped: false })
      );
      stars.position.set((x0 + x1) / 2, 4, zEdge - 6);
      stars.rotation.y = wins[0].dy > 0 ? Math.PI : 0;
      group.add(stars);
    }
    // hologram wall on the WEST bulkhead — content drawn by bridge.js
    const holo = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshBasicMaterial({ map: fs.holoTex, transparent: true, toneMapped: false })
    );
    holo.position.set(3 * CELL - 1.55, 3.4, 7.5 * CELL);
    holo.rotation.y = Math.PI / 2;
    group.add(holo);
    const hglow = new THREE.PointLight(0x2fd6c8, 6, 16, 1.6);
    hglow.position.set(3 * CELL + 1.5, 3.4, 7.5 * CELL);
    group.add(hglow);
    // the red-alert beacon over the mission console (missions.js pulses it)
    const beacon = new THREE.PointLight(0xff2222, 0, 20, 1.4);
    beacon.position.set(11.5 * CELL, 5.4, 11.3 * CELL);
    beacon.name = 'alertBeacon';
    group.add(beacon);
  }

  // dressed props (the staging bay parks real Kenney models — few, unmerged)
  for (const pr of g.shipProps || []) {
    const m = makePiece(pr.piece);
    m.scale.setScalar(pr.scale || 1);
    m.position.set(pr.x, pr.y || 0, pr.z);
    m.rotation.y = pr.yaw || 0;
    group.add(m);
  }

  // sparse room lights: the ceiling panels are fake — a few real points sell it
  const rooms = g.noCeil ? [] : (g.rooms || []).slice(0, 10);
  for (const r of rooms) {
    // physical lighting units (r155+): match the portal light's scale (18)
    const pl = new THREE.PointLight(0xe6f0f8, 22, 38, 1.4);
    pl.position.set(r.cx * CELL, CEIL_H - 1.4, r.cy * CELL);
    group.add(pl);
  }
  return group;
}
