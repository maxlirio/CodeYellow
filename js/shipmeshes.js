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

// deterministic star canvas — the bridge viewport and the hangar mouth share it
function makeStarTex(count = 1400, cw = 2048, ch = 256) {
  const sc = document.createElement('canvas');
  sc.width = cw; sc.height = ch;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#020409';
  sctx.fillRect(0, 0, cw, ch);
  let sseed = 1234;
  const srand = () => { sseed = (sseed * 16807) % 2147483647; return sseed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const b = srand();
    sctx.fillStyle = b > 0.94 ? '#bfe6ff' : b > 0.7 ? '#ffffff' : '#7d8ba0';
    const r = b > 0.96 ? 2.2 : b > 0.8 ? 1.4 : 0.8;
    sctx.fillRect(srand() * cw, srand() * ch, r, r);
  }
  const t = new THREE.CanvasTexture(sc);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  const mouthSet = new Set((g.mouth || []).map(m => `${m.cx},${m.cy},${m.dx},${m.dy}`));
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
        if (mouthSet.has(`${cx},${cy},${dx},${dy}`)) continue; // the hangar mouth is OPEN
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

  // ---- SET PIECES from semantic decor: each section's signature furniture.
  // Parts are built in ship-local coords (nose/long axis +z or +x as noted),
  // then rotated by the decor's yaw and dropped at its world position ----
  for (const d of g.shipDecor || []) {
    const part = (mat, geo, ox, oy, oz) => { geo.translate(ox, oy, oz); add(mat, geo, d.x, 0, d.z, d.yaw || 0); };
    const B = (mat, sx, sy, sz, ox, oy, oz) => part(mat, new THREE.BoxGeometry(sx, sy, sz), ox, oy, oz);
    if (d.kind === 'ship') {
      // DROPSHIP, nose +z: fuselage, canopy, wings, twin engines, tail, skids
      const tone = ['machine', 'crate', 'wall'][d.tone || 0];
      B('frame', 0.5, 0.4, 7.0, -1.4, 0.2, 0);   // skids
      B('frame', 0.5, 0.4, 7.0, 1.4, 0.2, 0);
      B(tone, 4.2, 2.1, 7.6, 0, 1.55, -0.4);      // fuselage
      B(tone, 3.0, 1.5, 2.6, 0, 1.3, 4.4);        // nose
      B('accent', 2.0, 0.7, 1.6, 0, 2.15, 3.6);   // canopy glass glows
      B(tone, 2.6, 0.28, 3.4, -3.3, 1.6, -1);     // wings
      B(tone, 2.6, 0.28, 3.4, 3.3, 1.6, -1);
      for (const sx of [-3.6, 3.6]) {             // wingtip engines + exhaust glow
        const eng = new THREE.CylinderGeometry(0.55, 0.62, 2.6, 8);
        eng.rotateX(Math.PI / 2);
        part('frame', eng, sx, 1.6, -2.2);
        B('accent', 0.7, 0.7, 0.12, sx, 1.6, -3.55);
      }
      B(tone, 0.28, 1.7, 2.2, 0, 3.1, -3.3);      // tail fin
      const ramp = new THREE.BoxGeometry(2.8, 0.3, 2.8);
      ramp.rotateX(0.45);
      part('dark', ramp, 0, 0.75, -5.2);          // aft boarding ramp
      const ring = new THREE.CylinderGeometry(5.4, 5.4, 0.05, 24, 1, true);
      part('accent', ring, 0, 0.05, 0);           // landing pad ring
    } else if (d.kind === 'turbine') {
      // DRIVE TURBINE: floor-to-ceiling cylinder, ringed and glowing
      const trunk = new THREE.CylinderGeometry(2.0, 2.15, d.h - 0.6, 12);
      part('machine', trunk, 0, (d.h - 0.6) / 2 + 0.5, 0);
      const base = new THREE.CylinderGeometry(2.4, 2.5, 0.7, 12);
      part('dark', base, 0, 0.35, 0);
      for (const ry of [1.7, 3.3, 4.9]) {
        const ring = new THREE.CylinderGeometry(2.1, 2.1, 0.16, 12, 1, true);
        part('accent', ring, 0, ry, 0);
      }
      const duct = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 8);
      part('frame', duct, 0, d.h + 0.4, 0);
    } else if (d.kind === 'container') {
      // SHIPPING CONTAINER (long axis x): ribbed body, corner frames, id stripe
      const tone = ['crate', 'machine', 'dark'][d.tone || 0];
      const build = (y0) => {
        B(tone, d.w, 2.5, d.d, 0, y0 + 1.25, 0);
        B('frame', d.w + 0.1, 0.2, d.d + 0.1, 0, y0 + 0.12, 0);
        B('frame', d.w + 0.1, 0.2, d.d + 0.1, 0, y0 + 2.42, 0);
        for (const sx of [-d.w / 2 + 0.1, d.w / 2 - 0.1]) B('frame', 0.22, 2.5, d.d + 0.12, sx, y0 + 1.25, 0);
        B('accent', d.w * 0.55, 0.14, 0.04, 0, y0 + 1.9, d.d / 2 + 0.01);
      };
      build(0);
      if (d.stacked) build(2.56);
    } else if (d.kind === 'cellbar') {
      // BRIG CELL: bar wall facing the aisle, rails top and bottom, lock light
      const off = (d.toward || 1) * 1.5;
      B('frame', 3.4, 0.14, 0.14, 0, 0.22, off);
      B('frame', 3.4, 0.14, 0.14, 0, 3.15, off);
      for (let bx = -1.45; bx <= 1.46; bx += 0.485) B('frame', 0.09, 3.1, 0.09, bx, 1.68, off);
      B('accent', 0.3, 0.22, 0.1, 1.2, 1.5, off + 0.08 * Math.sign(off)); // cell lock
      B('dark', 2.6, 0.5, 1.0, 0, 0.25, -off * 0.4); // bench inside
    } else if (d.kind === 'line') {
      // ASSEMBLY LINE (long axis x): conveyor body, glowing belt, printer arms
      const len = Math.max(d.w, d.d);
      B('machine', len, 1.0, 2.1, 0, 0.5, 0);
      B('accent', len - 0.5, 0.07, 0.6, 0, 1.06, 0); // the belt runs hot
      const n = d.arms || 2;
      for (let i = 0; i < n; i++) {
        const ax = -len / 2 + (i + 0.7) * (len / (n + 0.4));
        const az = (i % 2 ? 1 : -1) * 1.9;
        B('frame', 0.4, 2.8, 0.4, ax, 1.4, az);
        B('frame', 0.32, 0.32, 2.1, ax, 2.7, az * 0.45);
        B('accent', 0.2, 0.5, 0.2, ax, 1.65, 0); // print head over the belt
      }
    } else if (d.kind === 'bunk') {
      // BUNK BED (long axis follows w/d): posts, two racks, pillow strip
      const along = (d.w || 0) >= (d.d || 0);
      const L = Math.max(d.w, d.d), W = Math.min(d.w, d.d);
      const bx = along ? L : W, bz = along ? W : L;
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        B('frame', 0.16, 2.1, 0.16, sx * (bx / 2 - 0.1), 1.05, sz * (bz / 2 - 0.1));
      B('crate', bx - 0.1, 0.22, bz - 0.1, 0, 0.55, 0);
      B('crate', bx - 0.1, 0.22, bz - 0.1, 0, 1.55, 0);
      const px = along ? bx / 2 - 0.5 : 0, pz = along ? 0 : bz / 2 - 0.5;
      B('wall', 0.7, 0.14, 0.7, px, 0.72, pz); // pillow
      B('wall', 0.7, 0.14, 0.7, px, 1.72, pz);
    }
  }

  // ---- THE MOUTH (hangar decks): the south wall is OPEN — heavy door frame
  // columns, a knee sill, hazard striping. The force field itself is added
  // after the merge (it's translucent) ----
  if (g.mouth?.length) {
    const xs = g.mouth.map(m => m.cx * CELL);
    const mx0 = Math.min(...xs) - CELL / 2, mx1 = Math.max(...xs) + CELL / 2;
    const mz = (g.mouth[0].cy + 0.5) * CELL + 0.3;
    box('dark', (mx0 + mx1) / 2, 0.25, mz, mx1 - mx0, 0.5, 0.7);        // knee sill
    box('accent', (mx0 + mx1) / 2, 0.54, mz - 0.1, mx1 - mx0, 0.06, 0.5); // sill warning light
    box('dark', (mx0 + mx1) / 2, WALL_H - 0.5, mz, mx1 - mx0, 1.0, 0.9); // header beam
    box('accent', (mx0 + mx1) / 2, WALL_H - 1.05, mz - 0.1, mx1 - mx0, 0.1, 0.5);
    for (let x = mx0; x <= mx1 + 0.1; x += CELL * 5) {
      box('frame', x, WALL_H / 2, mz, 1.2, WALL_H, 1.3);                 // heavy mullion columns
      box('accent', x, WALL_H / 2, mz - 0.75, 0.16, WALL_H - 1.5, 0.06);
    }
    // hazard stripe painted on the deck along the opening
    box('accent', (mx0 + mx1) / 2, 0.012, mz - 2.2, mx1 - mx0, 0.012, 0.35);
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

  // GRAV LIFTS: a standing light beam from deck to balcony — step in, ride up
  for (const gl of g.gravlifts || []) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, gl.top + 0.4, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4fe8e0, transparent: true, opacity: 0.18, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(gl.x, (gl.top + 0.4) / 2, gl.z);
    group.add(beam);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.12, 10), mats.machine);
    pad.position.set(gl.x, 0.06, gl.z);
    group.add(pad);
    const ringB = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.1, 10, 1, true), mats.accent);
    ringB.position.set(gl.x, 0.18, gl.z);
    group.add(ringB);
    const ringT = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 10, 1, true), mats.accent);
    ringT.position.set(gl.x, gl.top + 0.28, gl.z);
    group.add(ringT);
  }

  // THE MOUTH's translucent skin + the space beyond (post-merge: transparent)
  if (g.mouth?.length) {
    const xs = g.mouth.map(m => m.cx * CELL);
    const mx0 = Math.min(...xs) - CELL / 2, mx1 = Math.max(...xs) + CELL / 2;
    const mz = (g.mouth[0].cy + 0.5) * CELL + 0.3;
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(mx1 - mx0, WALL_H - 1.4),
      new THREE.MeshBasicMaterial({
        color: 0x59e8ff, transparent: true, opacity: 0.13, toneMapped: false,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    field.position.set((mx0 + mx1) / 2, (WALL_H - 1.4) / 2 + 0.5, mz);
    group.add(field);
    const stars = new THREE.Mesh(
      new THREE.PlaneGeometry(mx1 - mx0 + 70, 34),
      new THREE.MeshBasicMaterial({ map: makeStarTex(), toneMapped: false })
    );
    stars.position.set((mx0 + mx1) / 2, 3, mz + 11);
    stars.rotation.y = Math.PI; // face back into the hangar
    group.add(stars);
  }

  // THE BRIDGE: starfield wrapped all the way around, a central holo table,
  // and stations built into the wall as SCREENS — a control room, not an office
  if (g.bridge) {
    const cx0 = (g.w / 2 - 0.5) * CELL, cz0 = (g.h / 2 - 0.5) * CELL; // room center
    // space, in every window: a star cylinder wrapping the whole deck
    const stars = new THREE.Mesh(
      new THREE.CylinderGeometry(38, 38, 44, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: makeStarTex(), toneMapped: false, side: THREE.BackSide })
    );
    stars.position.set(cx0, 4, cz0);
    group.add(stars);

    // THE HOLO TABLE — round pedestal, glowing top, a hologram of the hulk
    // floating above it (missions.js spins it and lights it up on red alert)
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.35, 1.0, 14), mats.machine);
    ped.position.set(cx0, 0.5, cz0);
    group.add(ped);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.06, 2.06, 0.14, 14, 1, true), mats.accent);
    ring.position.set(cx0, 0.88, cz0);
    group.add(ring);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.06, 14),
      new THREE.MeshBasicMaterial({ color: 0x1a4a46, toneMapped: false }));
    top.position.set(cx0, 1.06, cz0);
    group.add(top);
    // the hulk, in light: translucent hull + prow + engine block
    const holoMat = new THREE.MeshBasicMaterial({ color: 0x3fe8d8, transparent: true, opacity: 0.5, toneMapped: false });
    const holoShip = new THREE.Group();
    holoShip.name = 'holoShip';
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.55, 1.1), holoMat);
    holoShip.add(hull);
    const prow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 4), holoMat);
    prow.rotation.z = -Math.PI / 2;
    prow.position.x = 2.35;
    holoShip.add(prow);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.5), holoMat);
    spine.position.set(-0.4, 0.42, 0);
    holoShip.add(spine);
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1.5), holoMat);
    eng.position.x = -2.1;
    holoShip.add(eng);
    for (const oz of [-0.45, 0, 0.45]) {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6), holoMat);
      noz.rotation.z = Math.PI / 2;
      noz.position.set(-2.6, 0, oz);
      holoShip.add(noz);
    }
    // the alert marker: a red node that pulses on the hull when a signature lands
    const alertNode = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3322, toneMapped: false }));
    alertNode.name = 'holoAlert';
    alertNode.visible = false;
    alertNode.position.set(0.8, 0.35, 0);
    holoShip.add(alertNode);
    holoShip.position.set(cx0, 2.15, cz0);
    group.add(holoShip);
    const tlight = new THREE.PointLight(0x2fd6c8, 10, 14, 1.6);
    tlight.position.set(cx0, 2.6, cz0);
    group.add(tlight);
    // floor guide ring around the table
    const fring = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.03, 24, 1, true), mats.accent);
    fring.position.set(cx0, 0.05, cz0);
    group.add(fring);

    // WALL STATIONS: screens set into the bulkheads, consoles beneath them
    const mkScreen = (tex, wdt, hgt) => new THREE.Mesh(
      new THREE.PlaneGeometry(wdt, hgt),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    const label = (text, sub) => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 288;
      const cc = c.getContext('2d');
      cc.fillStyle = 'rgba(8, 22, 30, 0.94)';
      cc.fillRect(0, 0, 512, 288);
      cc.strokeStyle = '#2fd6c8'; cc.lineWidth = 5;
      cc.strokeRect(5, 5, 502, 278);
      cc.fillStyle = '#2fd6c8';
      cc.font = 'bold 40px Menlo, monospace';
      cc.textAlign = 'center';
      cc.fillText(text, 256, 120);
      cc.fillStyle = '#7fb8b2';
      cc.font = '24px Menlo, monospace';
      cc.fillText(sub, 256, 175);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    for (const s of g.screens || []) {
      let scr;
      if (s.kind === 'status') scr = mkScreen(fs.holoTex, 8.4, 4.2);
      else if (s.kind === 'comms') scr = mkScreen(label('COMMS — JOINT OPS', 'public games · press E'), 4.6, 2.6);
      else if (s.kind === 'training') scr = mkScreen(label('TRAINING', 'spend skill points · press E'), 4.6, 2.6);
      else scr = mkScreen(label('SIM DECK', 'change venture · press E'), 4.6, 2.6);
      scr.position.set(s.x, s.kind === 'status' ? 3.3 : 3.1, s.z);
      scr.rotation.y = s.ry;
      group.add(scr);
      // slim console bench beneath, integrated into the wall (the geometry
      // buckets are already merged by now — direct meshes only in this block)
      const nx = Math.sin(s.ry), nz = Math.cos(s.ry); // screen normal (into the room)
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(s.ry === Math.PI ? 3.4 : 1.0, 1.1, s.ry === Math.PI ? 1.0 : 3.4), mats.machine);
      bench.position.set(s.x + nx * 0.45, 0.55, s.z + nz * 0.45);
      group.add(bench);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(s.ry === Math.PI ? 3.0 : 0.08, 0.06, s.ry === Math.PI ? 0.08 : 3.0), mats.accent);
      strip.position.set(s.x + nx * 0.98, 1.08, s.z + nz * 0.98);
      group.add(strip);
      const sl = new THREE.PointLight(0x2fd6c8, 4, 9, 1.8);
      sl.position.set(s.x + nx * 1.6, 3.0, s.z + nz * 1.6);
      group.add(sl);
    }

    // the red-alert beacon, high over the table (missions.js pulses it)
    const beacon = new THREE.PointLight(0xff2222, 0, 26, 1.3);
    beacon.position.set(cx0, 5.8, cz0);
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
