/**
 * Procedural pixel-art tileset generator.
 * Draws a spritesheet of 32x32 tiles to a canvas with texture, shading, and detail.
 */

const T = 64; // tile size (64px for 16-bit detail)

// Seeded random for deterministic tile textures
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function rgbStr(r, g, b, a = 1) {
  return `rgba(${r|0},${g|0},${b|0},${a})`;
}

function vary(rng, base, amount) {
  return Math.max(0, Math.min(255, base + (rng() - 0.5) * amount));
}

// ── Helpers for 16-bit style ──

function dither(rng, val, amount) {
  // Ordered dither: adds texture without pure noise
  return val + (rng() > 0.5 ? amount : -amount);
}

function drawShadedRect(ctx, x, y, w, h, r, g, b, rng) {
  // Filled rect with top highlight and bottom shadow
  ctx.fillStyle = rgbStr(r, g, b);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = `rgba(255,255,255,0.15)`;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = `rgba(0,0,0,0.2)`;
  ctx.fillRect(x, y + h - 1, w, 1);
}

// ── Individual tile painters (16-bit SNES style) ──

function paintDeepWater(ctx, x, y, rng) {
  // Deep ocean — dark with layered wave patterns
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave1 = Math.sin((px + py * 0.7) * 0.35) * 6;
      const wave2 = Math.sin((px * 0.6 - py * 0.4) * 0.5) * 4;
      const depth = py / T * 8; // darker at bottom
      const d = (px + py) % 3 === 0 ? 3 : 0; // subtle dither pattern
      ctx.fillStyle = rgbStr(
        12 + wave1 + d,
        24 + wave1 + wave2 - depth,
        52 + wave2 * 2 - depth + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Subtle foam streaks
  for (let i = 0; i < 3; i++) {
    const fy = (rng() * 28 + 2) | 0;
    const fx = (rng() * 16 + 4) | 0;
    const fw = (rng() * 8 + 4) | 0;
    ctx.fillStyle = 'rgba(40,60,100,0.4)';
    ctx.fillRect(x + fx, y + fy, fw, 1);
  }
}

function paintWater(ctx, x, y, rng) {
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave1 = Math.sin((px * 0.4 + py * 0.25) * 1.2) * 10;
      const wave2 = Math.cos((px * 0.2 - py * 0.3) * 0.8) * 6;
      const d = ((px + py) % 2 === 0) ? 4 : 0;
      ctx.fillStyle = rgbStr(
        28 + wave1 + d,
        55 + wave1 + wave2,
        95 + wave2 * 1.5 + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Sparkle highlights
  for (let i = 0; i < 5; i++) {
    const sx = (rng() * 28 + 2) | 0;
    const sy = (rng() * 28 + 2) | 0;
    ctx.fillStyle = 'rgba(140,180,220,0.5)';
    ctx.fillRect(x + sx, y + sy, 1, 1);
    ctx.fillStyle = 'rgba(180,210,240,0.3)';
    ctx.fillRect(x + sx + 1, y + sy, 1, 1);
  }
}

function paintSand(ctx, x, y, rng) {
  // Warm sand with wind ripples and dithered texture
  for (let py = 0; py < T; py++) {
    const ripple = Math.sin(py * 0.6) * 4;
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 6 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, 190 + ripple, 8) + d,
        vary(rng, 174 + ripple * 0.8, 6) + d,
        vary(rng, 120, 10)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Pebbles with shadow
  for (let i = 0; i < 3; i++) {
    if (rng() > 0.35) {
      const px = (rng() * 24 + 4) | 0;
      const py = (rng() * 24 + 4) | 0;
      ctx.fillStyle = rgbStr(155, 145, 105);
      ctx.fillRect(x + px, y + py, 2, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x + px, y + py, 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + px, y + py + 2, 2, 1);
    }
  }
  // Occasional shell
  if (rng() > 0.7) {
    const sx = (rng() * 22 + 5) | 0;
    const sy = (rng() * 22 + 5) | 0;
    ctx.fillStyle = rgbStr(220, 210, 190);
    ctx.fillRect(x + sx, y + sy, 3, 2);
    ctx.fillStyle = rgbStr(200, 185, 160);
    ctx.fillRect(x + sx + 1, y + sy + 1, 1, 1);
  }
}

function paintDirt(ctx, x, y, rng, baseR = 90, baseG = 65, baseB = 38) {
  // Rich soil with layered texture
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const layer = Math.sin(py * 0.4 + px * 0.1) * 5;
      const d = ((px + py) % 3 === 0) ? 5 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, baseR + layer, 10) + d,
        vary(rng, baseG + layer * 0.7, 8) + d,
        vary(rng, baseB, 6)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Small rocks with highlights
  for (let i = 0; i < 4; i++) {
    if (rng() > 0.3) {
      const rx = (rng() * 26 + 3) | 0;
      const ry = (rng() * 26 + 3) | 0;
      const rw = (rng() * 2 + 2) | 0;
      ctx.fillStyle = rgbStr(65 + rng() * 25, 50 + rng() * 20, 30 + rng() * 15);
      ctx.fillRect(x + rx, y + ry, rw, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + rx, y + ry, rw, 1);
    }
  }
  // Worm trail
  if (rng() > 0.6) {
    const wx = (rng() * 20 + 6) | 0;
    const wy = (rng() * 20 + 6) | 0;
    ctx.fillStyle = rgbStr(baseR - 12, baseG - 10, baseB - 6);
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(x + wx + i * 2, y + wy + ((i % 2) ? 1 : 0), 2, 1);
    }
  }
}

function paintAlienGrass(ctx, x, y, rng) {
  // Lush alien ground with color variation patches
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const patch = Math.sin(px * 0.3 + py * 0.4) * 8;
      const d = ((px + py) % 2 === 0) ? 4 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, 36 + patch, 8) + d,
        vary(rng, 82 + patch * 1.5, 10),
        vary(rng, 40, 8) + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Grass tufts — multi-height blades with shading
  for (let i = 0; i < 10; i++) {
    const gx = (rng() * 28 + 2) | 0;
    const gy = (rng() * 16 + 12) | 0;
    const h = (rng() * 4 + 3) | 0;
    const bright = 90 + rng() * 50;
    // Dark side
    ctx.fillStyle = rgbStr(30, bright * 0.7, 35);
    ctx.fillRect(x + gx, y + gy - h, 1, h);
    // Light tip
    ctx.fillStyle = rgbStr(50, bright, 50 + rng() * 20);
    ctx.fillRect(x + gx, y + gy - h, 1, 2);
    // Secondary blade
    if (rng() > 0.4) {
      ctx.fillStyle = rgbStr(35, bright * 0.8, 40);
      ctx.fillRect(x + gx + 1, y + gy - h + 1, 1, h - 1);
    }
  }
  // Small flowers
  if (rng() > 0.5) {
    const fx = (rng() * 24 + 4) | 0;
    const fy = (rng() * 16 + 6) | 0;
    ctx.fillStyle = rgbStr(180 + rng() * 60, 80 + rng() * 80, 200 + rng() * 55);
    ctx.fillRect(x + fx, y + fy, 2, 2);
    ctx.fillStyle = rgbStr(240, 220, 80);
    ctx.fillRect(x + fx, y + fy, 1, 1);
  }
}

function paintRock(ctx, x, y, rng) {
  // Multi-layered rock with geological strata
  for (let py = 0; py < T; py++) {
    const stratum = Math.floor(py / 6);
    const stratumShift = (stratum % 3) * 5 - 5;
    for (let px = 0; px < T; px++) {
      const crack = Math.abs(Math.sin(px * 1.2 + py * 0.8));
      const crackDark = crack < 0.08 ? -20 : 0;
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, 90 + stratumShift + crackDark, 6) + d,
        vary(rng, 88 + stratumShift + crackDark, 6) + d,
        vary(rng, 82 + crackDark, 5) + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Top-left highlight
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x, y, T, 1);
  ctx.fillRect(x, y, 1, T);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x + 1, y + 1, T - 2, 1);
  // Bottom-right shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x, y + T - 1, T, 1);
  ctx.fillRect(x + T - 1, y, 1, T);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(x + 1, y + T - 2, T - 2, 1);
  // Moss patches
  for (let i = 0; i < 2; i++) {
    if (rng() > 0.4) {
      const mx = (rng() * 20 + 4) | 0;
      const my = (rng() * 8 + 2) | 0;
      ctx.fillStyle = rgbStr(55, 80 + rng() * 20, 45);
      ctx.fillRect(x + mx, y + my, 3, 2);
    }
  }
}

function paintDenseRock(ctx, x, y, rng, baseR = 58, baseG = 56, baseB = 54) {
  // Dark dense rock with faceted look
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const facet = Math.floor((px + py * 1.3) / 8) % 3;
      const shift = facet * 4 - 4;
      const d = ((px + py) % 3 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, baseR + shift, 5) + d,
        vary(rng, baseG + shift, 5) + d,
        vary(rng, baseB + shift, 4) + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Deep cracks with shadow and highlight
  const cracks = [
    [[8, 3], [14, 12], [22, 9]],
    [[3, 18], [12, 24], [18, 22]],
  ];
  for (const crack of cracks) {
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + crack[0][0], y + crack[0][1]);
    for (let i = 1; i < crack.length; i++) ctx.lineTo(x + crack[i][0], y + crack[i][1]);
    ctx.stroke();
    // Highlight edge
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(x + crack[0][0], y + crack[0][1] - 1);
    for (let i = 1; i < crack.length; i++) ctx.lineTo(x + crack[i][0], y + crack[i][1] - 1);
    ctx.stroke();
  }
  // Edge shading
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, T, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x, y + T - 1, T, 1);
}

function paintOre(ctx, x, y, rng, oreColor) {
  // Rock base with richer texture
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, 78, 6) + d,
        vary(rng, 75, 6) + d,
        vary(rng, 70, 5) + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Ore veins — larger clusters with depth
  const oc = hexToRgb(oreColor);
  for (let i = 0; i < 6; i++) {
    const vx = (rng() * 22 + 5) | 0;
    const vy = (rng() * 22 + 5) | 0;
    const w = (rng() * 4 + 2) | 0;
    const h = (rng() * 3 + 2) | 0;
    // Dark outline
    ctx.fillStyle = rgbStr(oc.r * 0.5, oc.g * 0.5, oc.b * 0.5);
    ctx.fillRect(x + vx - 1, y + vy - 1, w + 2, h + 2);
    // Ore body
    ctx.fillStyle = rgbStr(oc.r, oc.g, oc.b);
    ctx.fillRect(x + vx, y + vy, w, h);
    // Highlight
    ctx.fillStyle = rgbStr(
      Math.min(255, oc.r + 70),
      Math.min(255, oc.g + 70),
      Math.min(255, oc.b + 70)
    );
    ctx.fillRect(x + vx, y + vy, w, 1);
    ctx.fillRect(x + vx, y + vy, 1, h);
    // Sparkle
    if (rng() > 0.3) {
      ctx.fillStyle = rgbStr(255, 255, 240);
      ctx.fillRect(x + vx + 1, y + vy + 1, 1, 1);
    }
  }
}

function paintAlienFlora(ctx, x, y, rng) {
  paintAlienGrass(ctx, x, y, rng);
  // Bioluminescent alien plants — taller, with glow halos
  for (let i = 0; i < 4; i++) {
    const px = (rng() * 22 + 5) | 0;
    const py = (rng() * 12 + 14) | 0;
    const h = (rng() * 7 + 5) | 0;
    const hue = rng();
    // Stem with gradient
    for (let s = 0; s < h; s++) {
      const t = s / h;
      ctx.fillStyle = rgbStr(25 + t * 15, 80 + t * 40, 40 + t * 20);
      ctx.fillRect(x + px, y + py - s, 1, 1);
    }
    // Glowing bulb (3x3 with soft edges)
    const br = hue > 0.5 ? 60 : 30;
    const bg = hue > 0.5 ? 220 : 200;
    const bb = hue > 0.5 ? 120 : 220;
    // Glow halo
    ctx.fillStyle = rgbStr(br, bg, bb, 0.06);
    ctx.fillRect(x + px - 3, y + py - h - 3, 7, 6);
    ctx.fillStyle = rgbStr(br, bg, bb, 0.12);
    ctx.fillRect(x + px - 2, y + py - h - 2, 5, 4);
    // Bulb
    ctx.fillStyle = rgbStr(br + 40, bg, bb);
    ctx.fillRect(x + px - 1, y + py - h - 1, 3, 3);
    ctx.fillStyle = rgbStr(br + 80, Math.min(255, bg + 30), bb + 20);
    ctx.fillRect(x + px, y + py - h, 1, 1);
  }
}

function paintAlienTree(ctx, x, y, rng) {
  paintAlienGrass(ctx, x, y, rng);
  // Trunk with bark texture
  const trunkX = 12 + (rng() * 6) | 0;
  const trunkW = 5 + (rng() * 2) | 0;
  const trunkH = 14 + (rng() * 4) | 0;
  for (let ty = 0; ty < trunkH; ty++) {
    for (let tx = 0; tx < trunkW; tx++) {
      const bark = (ty % 4 < 1) ? -8 : 0;
      const edge = (tx === 0) ? -12 : (tx === trunkW - 1) ? -8 : 0;
      ctx.fillStyle = rgbStr(48 + edge + bark + rng() * 10, 34 + edge + bark + rng() * 8, 18 + rng() * 6);
      ctx.fillRect(x + trunkX + tx, y + T - trunkH + ty, 1, 1);
    }
  }
  // Root bulges
  ctx.fillStyle = rgbStr(42, 30, 16);
  ctx.fillRect(x + trunkX - 1, y + T - 3, 1, 3);
  ctx.fillRect(x + trunkX + trunkW, y + T - 2, 1, 2);

  // Canopy — multi-layered with depth
  const canopyR = 9 + (rng() * 3) | 0;
  const cx = trunkX + trunkW / 2;
  const cy = T - trunkH - canopyR + 5;
  // Shadow layer
  for (let dy = -canopyR; dy <= canopyR + 1; dy++) {
    for (let dx = -canopyR; dx <= canopyR; dx++) {
      if (dx * dx + dy * dy <= (canopyR + 1) * (canopyR + 1)) {
        const px2 = x + cx + dx; const py2 = y + cy + dy + 1;
        if (px2 >= x && px2 < x + T && py2 >= y && py2 < y + T) {
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.fillRect(px2, py2, 1, 1);
        }
      }
    }
  }
  // Main canopy
  for (let dy = -canopyR; dy <= canopyR; dy++) {
    for (let dx = -canopyR; dx <= canopyR; dx++) {
      if (dx * dx + dy * dy <= canopyR * canopyR) {
        const px2 = x + cx + dx; const py2 = y + cy + dy;
        if (px2 >= x && px2 < x + T && py2 >= y && py2 < y + T) {
          const light = dy < -canopyR * 0.3 ? 20 : dy > canopyR * 0.3 ? -15 : 0;
          const d = ((dx + dy) % 2 === 0) ? 6 : 0;
          ctx.fillStyle = rgbStr(
            18 + rng() * 25 + d,
            75 + rng() * 50 + light,
            35 + rng() * 35 + (rng() > 0.9 ? 25 : 0)
          );
          ctx.fillRect(px2, py2, 1, 1);
        }
      }
    }
  }
  // Canopy highlight
  ctx.fillStyle = 'rgba(120,255,140,0.12)';
  ctx.fillRect(x + cx - 4, y + cy - canopyR, 8, 2);
}

function paintCrystal(ctx, x, y, rng, crystalColor = null) {
  const cc = crystalColor ? hexToRgb(crystalColor) : null;
  // Dark rocky ground
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(vary(rng, 32 + d, 5), vary(rng, 36 + d, 5), vary(rng, 45, 6));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Crystal formations — faceted with light/dark sides
  for (let i = 0; i < 5; i++) {
    const cx2 = (rng() * 20 + 6) | 0;
    const cy2 = (rng() * 12 + 14) | 0;
    const h = (rng() * 9 + 5) | 0;
    const w = (rng() * 2 + 2) | 0;
    const bright = 0.6 + rng() * 0.4;
    const cr = cc ? cc.r * bright : 80 * bright;
    const cg = cc ? cc.g * bright : 160 * bright;
    const cb = cc ? cc.b * bright : 220 * bright;
    // Glow halo
    ctx.fillStyle = rgbStr(cr, cg, cb, 0.06);
    ctx.fillRect(x + cx2 - 2, y + cy2 - h - 2, w + 4, h + 4);
    // Dark side
    ctx.fillStyle = rgbStr(cr * 0.5, cg * 0.5, cb * 0.5);
    ctx.fillRect(x + cx2 + w - 1, y + cy2 - h, 1, h);
    // Light side
    ctx.fillStyle = rgbStr(cr, cg, cb);
    ctx.fillRect(x + cx2, y + cy2 - h, w - 1, h);
    // Bright highlight
    ctx.fillStyle = rgbStr(
      Math.min(255, cr + 80),
      Math.min(255, cg + 80),
      Math.min(255, cb + 80)
    );
    ctx.fillRect(x + cx2, y + cy2 - h, 1, 2);
    // Tip sparkle
    ctx.fillStyle = rgbStr(230, 245, 255);
    ctx.fillRect(x + cx2, y + cy2 - h, 1, 1);
  }
}

function paintWall(ctx, x, y, rng) {
  const base = { r: 72, g: 72, b: 82 };
  // Brick pattern
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const brickRow = (py / 8) | 0;
      const offset = brickRow % 2 === 0 ? 0 : 8;
      const brickEdgeX = (px + offset) % 16 < 1;
      const brickEdgeY = py % 8 < 1;
      const edge = (brickEdgeX || brickEdgeY) ? -20 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r + edge, 6),
        vary(rng, base.g + edge, 6),
        vary(rng, base.b + edge, 8)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintFloor(ctx, x, y, rng) {
  // Dirt base under cobblestones
  const dirt = { r: 75, g: 60, b: 42 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, dirt.r, 8), vary(rng, dirt.g, 6), vary(rng, dirt.b, 6));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }

  // Cobblestones — irregular rounded rectangles
  const stones = [
    [2, 2, 8, 6], [11, 1, 7, 7], [20, 2, 9, 6],
    [1, 10, 9, 7], [12, 9, 8, 8], [22, 10, 8, 6],
    [3, 19, 7, 7], [12, 18, 9, 6], [23, 19, 7, 7],
    [1, 27, 8, 4], [11, 26, 8, 5], [21, 27, 9, 4],
  ];

  for (const [sx, sy, sw, sh] of stones) {
    const shade = 90 + (rng() * 35) | 0;
    // Stone fill
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        // Round corners
        const corner = (px === 0 && py === 0) || (px === sw-1 && py === 0) ||
                       (px === 0 && py === sh-1) || (px === sw-1 && py === sh-1);
        if (corner) continue;

        const highlight = py < 2 ? 12 : (py > sh - 2 ? -10 : 0);
        ctx.fillStyle = rgbStr(
          vary(rng, shade + highlight, 6),
          vary(rng, shade - 5 + highlight, 6),
          vary(rng, shade - 10 + highlight, 5)
        );
        ctx.fillRect(x + sx + px, y + sy + py, 1, 1);
      }
    }
  }

  // Subtle border to show it's a placed tile
  ctx.strokeStyle = 'rgba(180,170,140,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

function paintChest(ctx, x, y, rng, baseR, baseG, baseB) {
  // Ground
  paintDirt(ctx, x, y, rng);
  // Chest body
  const cx = x + 5, cy = y + 10, cw = 22, ch = 16;
  ctx.fillStyle = rgbStr(baseR, baseG, baseB);
  ctx.fillRect(cx, cy, cw, ch);
  // Lid (slightly lighter)
  ctx.fillStyle = rgbStr(baseR + 20, baseG + 20, baseB + 15);
  ctx.fillRect(cx, cy, cw, 6);
  // Border
  ctx.strokeStyle = rgbStr(baseR - 30, baseG - 30, baseB - 25);
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
  // Lid line
  ctx.fillStyle = rgbStr(baseR - 20, baseG - 20, baseB - 15);
  ctx.fillRect(cx + 1, cy + 5, cw - 2, 1);
  // Lock/latch
  ctx.fillStyle = rgbStr(200, 180, 80);
  ctx.fillRect(cx + 9, cy + 4, 4, 4);
  ctx.fillStyle = rgbStr(160, 140, 50);
  ctx.fillRect(cx + 10, cy + 5, 2, 2);
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(cx + 2, cy + 1, cw - 4, 3);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(cx, cy + ch, cw, 2);
}

function paintSign(ctx, x, y, rng) {
  // Dirt base
  paintDirt(ctx, x, y, rng);
  // Wooden post
  ctx.fillStyle = rgbStr(90, 65, 35);
  ctx.fillRect(x + 14, y + 10, 4, 20);
  // Sign board
  const boardY = y + 6;
  ctx.fillStyle = rgbStr(160, 125, 70);
  ctx.fillRect(x + 5, boardY, 22, 14);
  // Board border
  ctx.strokeStyle = rgbStr(100, 75, 40);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5.5, boardY + 0.5, 21, 13);
  // Text lines (decorative)
  ctx.fillStyle = rgbStr(60, 45, 25);
  ctx.fillRect(x + 8, boardY + 3, 16, 1);
  ctx.fillRect(x + 8, boardY + 6, 14, 1);
  ctx.fillRect(x + 8, boardY + 9, 10, 1);
  // Wood grain on post
  ctx.fillStyle = rgbStr(75, 55, 30);
  ctx.fillRect(x + 15, y + 14, 1, 3);
  ctx.fillRect(x + 15, y + 20, 1, 2);
}

function paintMachine(ctx, x, y, rng, color, symbol) {
  const c = hexToRgb(color);
  // Metal base plate
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const highlight = (py < 4) ? 15 : (py > 28) ? -15 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, c.r + highlight, 8),
        vary(rng, c.g + highlight, 8),
        vary(rng, c.b + highlight, 8)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Border
  ctx.strokeStyle = rgbStr(c.r * 0.6, c.g * 0.6, c.b * 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
  // Inner details — bolts
  ctx.fillStyle = rgbStr(c.r * 0.5, c.g * 0.5, c.b * 0.5);
  ctx.fillRect(x + 3, y + 3, 2, 2);
  ctx.fillRect(x + T - 5, y + 3, 2, 2);
  ctx.fillRect(x + 3, y + T - 5, 2, 2);
  ctx.fillRect(x + T - 5, y + T - 5, 2, 2);
  // Center symbol
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, x + T / 2, y + T / 2 + 1);
}

function paintStairsDown(ctx, x, y, rng) {
  // Stone base
  const base = { r: 70, g: 65, b: 58 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, base.r, 8), vary(rng, base.g, 8), vary(rng, base.b, 6));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Steps descending (darker toward bottom = going down)
  const steps = 5;
  const stepH = Math.floor(T / steps);
  for (let i = 0; i < steps; i++) {
    const shade = 80 - i * 12;
    const sy = y + i * stepH;
    const indent = i * 2;
    ctx.fillStyle = rgbStr(shade, shade - 5, shade - 10);
    ctx.fillRect(x + indent, sy, T - indent * 2, stepH - 1);
    // Step edge highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + indent, sy, T - indent * 2, 1);
    // Step shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + indent, sy + stepH - 1, T - indent * 2, 1);
  }
  // Down arrow
  ctx.fillStyle = 'rgba(255,200,80,0.7)';
  ctx.fillRect(x + 14, y + 4, 4, 6);
  ctx.fillRect(x + 12, y + 10, 8, 2);
  ctx.fillRect(x + 14, y + 12, 4, 2);
}

function paintStairsUp(ctx, x, y, rng) {
  // Stone base
  const base = { r: 70, g: 65, b: 58 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, base.r, 8), vary(rng, base.g, 8), vary(rng, base.b, 6));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Steps ascending (lighter toward bottom = going up)
  const steps = 5;
  const stepH = Math.floor(T / steps);
  for (let i = 0; i < steps; i++) {
    const shade = 40 + i * 12;
    const sy = y + i * stepH;
    const indent = (steps - 1 - i) * 2;
    ctx.fillStyle = rgbStr(shade, shade - 5, shade - 10);
    ctx.fillRect(x + indent, sy, T - indent * 2, stepH - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + indent, sy, T - indent * 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + indent, sy + stepH - 1, T - indent * 2, 1);
  }
  // Up arrow
  ctx.fillStyle = 'rgba(80,220,255,0.7)';
  ctx.fillRect(x + 14, y + 8, 4, 6);
  ctx.fillRect(x + 12, y + 6, 8, 2);
  ctx.fillRect(x + 14, y + 4, 4, 2);
}

function paintFarmPlot(ctx, x, y, rng) {
  const base = { r: 70, g: 50, b: 25 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, base.r, 10), vary(rng, base.g, 8), vary(rng, base.b, 6));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Furrow lines
  for (let row = 0; row < 4; row++) {
    const fy = y + 4 + row * 8;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 2, fy, T - 4, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 2, fy + 1, T - 4, 1);
  }
  ctx.strokeStyle = 'rgba(100,80,40,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

function paintFarmGrowing(ctx, x, y, rng) {
  paintFarmPlot(ctx, x, y, rng);
  // Small seedlings
  for (let i = 0; i < 6; i++) {
    const sx = (rng() * 22 + 5) | 0;
    const sy = (rng() * 14 + 14) | 0;
    ctx.fillStyle = rgbStr(50 + rng() * 30, 100 + rng() * 40, 30);
    ctx.fillRect(x + sx, y + sy - 4, 1, 4);
    ctx.fillStyle = rgbStr(60 + rng() * 20, 120 + rng() * 30, 40);
    ctx.fillRect(x + sx - 1, y + sy - 5, 3, 2);
  }
}

function paintFarmReady(ctx, x, y, rng) {
  paintFarmPlot(ctx, x, y, rng);
  // Tall wheat stalks
  for (let i = 0; i < 8; i++) {
    const sx = (rng() * 24 + 4) | 0;
    const sy = (rng() * 8 + 18) | 0;
    const h = (rng() * 6 + 8) | 0;
    // Stalk
    ctx.fillStyle = rgbStr(160 + rng() * 30, 140 + rng() * 20, 40);
    ctx.fillRect(x + sx, y + sy - h, 1, h);
    // Wheat head
    ctx.fillStyle = rgbStr(200 + rng() * 40, 180 + rng() * 30, 50);
    ctx.fillRect(x + sx - 1, y + sy - h - 2, 3, 3);
    ctx.fillStyle = rgbStr(220, 200, 80);
    ctx.fillRect(x + sx, y + sy - h - 2, 1, 1);
  }
}

// ── Main generator ──

export function generateTileset(scene) {
  const tileCount = 17; // 0-11 terrain + 100-102 build + 200-201 machines (in painters array)
  const canvas = document.createElement('canvas');
  canvas.width = T * tileCount;
  canvas.height = T;
  const ctx = canvas.getContext('2d');

  const painters = [
    (x, y) => paintDeepWater(ctx, x, y, mulberry32(100)),        // 0
    (x, y) => paintWater(ctx, x, y, mulberry32(200)),             // 1
    (x, y) => paintSand(ctx, x, y, mulberry32(300)),              // 2
    (x, y) => paintDirt(ctx, x, y, mulberry32(400)),              // 3
    (x, y) => paintAlienGrass(ctx, x, y, mulberry32(500)),        // 4
    (x, y) => paintRock(ctx, x, y, mulberry32(600)),              // 5
    (x, y) => paintDenseRock(ctx, x, y, mulberry32(700)),         // 6
    (x, y) => paintOre(ctx, x, y, mulberry32(800), 0x8b5e3c),    // 7 iron
    (x, y) => paintOre(ctx, x, y, mulberry32(900), 0xb87333),    // 8 copper
    (x, y) => paintAlienFlora(ctx, x, y, mulberry32(1000)),       // 9
    (x, y) => paintCrystal(ctx, x, y, mulberry32(1100)),          // 10
    (x, y) => paintAlienTree(ctx, x, y, mulberry32(1150)),        // 11
    (x, y) => paintWall(ctx, x, y, mulberry32(1200)),             // 12 -> 100
    (x, y) => paintFloor(ctx, x, y, mulberry32(1300)),            // 13 -> 101
    (x, y) => paintSign(ctx, x, y, mulberry32(1350)),             // 14 -> 102
    (x, y) => paintMachine(ctx, x, y, mulberry32(1400), 0xcc8833, 'M'),  // 15 -> 200 miner
    (x, y) => paintMachine(ctx, x, y, mulberry32(1500), 0x6688cc, 'F'),  // 16 -> 201 fabricator
  ];

  painters.forEach((paint, i) => paint(i * T, 0));

  // Add extra machine tiles by extending canvas
  const canvas2 = document.createElement('canvas');
  canvas2.width = T * (tileCount + 16); // +storage, furnace, 4 chests, 5 underground, 2 stairs, 3 farm
  canvas2.height = T;
  const ctx2 = canvas2.getContext('2d');
  ctx2.drawImage(canvas, 0, 0);

  // Storage (index 17 -> 202)
  paintMachine(ctx2, 17 * T, 0, mulberry32(1600), 0x886644, 'S');
  // Furnace (index 18 -> 203)
  paintMachine(ctx2, 18 * T, 0, mulberry32(1700), 0xcc4422, 'Fu');
  // Chests (index 19-22 -> 204-207)
  paintChest(ctx2, 19 * T, 0, mulberry32(1800), 139, 107, 58);  // wood
  paintChest(ctx2, 20 * T, 0, mulberry32(1810), 95, 95, 90);    // stone
  paintChest(ctx2, 21 * T, 0, mulberry32(1820), 184, 115, 51);  // copper
  paintChest(ctx2, 22 * T, 0, mulberry32(1830), 130, 140, 155); // iron
  // Underground tiles (index 23-27 -> 12-16)
  paintDirt(ctx2, 23 * T, 0, mulberry32(2000), 50, 40, 30);     // cave_floor (darker dirt)
  paintDenseRock(ctx2, 24 * T, 0, mulberry32(2100), 35, 30, 25); // cave_wall
  paintOre(ctx2, 25 * T, 0, mulberry32(2200), 0xa06437);        // deep_iron
  paintOre(ctx2, 26 * T, 0, mulberry32(2300), 0xbe7d37);        // deep_copper
  paintCrystal(ctx2, 27 * T, 0, mulberry32(2400), 0xa0dcff);    // rare_crystal
  // Stairs (index 28-29 -> 103-104)
  paintStairsDown(ctx2, 28 * T, 0, mulberry32(2500));
  paintStairsUp(ctx2, 29 * T, 0, mulberry32(2600));
  // Farm tiles (index 30-32 -> 105-107)
  paintFarmPlot(ctx2, 30 * T, 0, mulberry32(2700));
  paintFarmGrowing(ctx2, 31 * T, 0, mulberry32(2800));
  paintFarmReady(ctx2, 32 * T, 0, mulberry32(2900));

  // Register as Phaser texture
  if (scene.textures.exists('tileset')) {
    scene.textures.remove('tileset');
  }
  scene.textures.addCanvas('tileset', canvas2);

  return canvas2;
}

// Map tile IDs to tileset indices
const TILE_INDEX_MAP = {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
  7: 7, 8: 8, 9: 9, 10: 10, 11: 11,
  12: 23, 13: 24, 14: 25, 15: 26, 16: 27, // underground tiles
  100: 12, 101: 13, 102: 14, 103: 28, 104: 29, 105: 30, 106: 31, 107: 32,
  200: 15, 201: 16, 202: 17, 203: 18,
  204: 19, 205: 20, 206: 21, 207: 22,
};

export function getTileIndex(tileId) {
  return TILE_INDEX_MAP[tileId] ?? 3; // default to dirt
}

export function generatePlayerTextures(scene) {
  const gfx = scene.add.graphics();
  const S = T / 32; // scale factor from original 32px design

  // Self player — green sci-fi suit
  gfx.clear();
  gfx.fillStyle(0x006644, 1);
  gfx.fillRect(10*S, 10*S, 12*S, 16*S);
  gfx.fillStyle(0x00ff88, 1);
  gfx.fillRect(11*S, 4*S, 10*S, 10*S);
  gfx.fillStyle(0x88ffcc, 1);
  gfx.fillRect(13*S, 6*S, 6*S, 4*S);
  gfx.fillStyle(0x005533, 1);
  gfx.fillRect(7*S, 12*S, 3*S, 10*S);
  gfx.fillRect(22*S, 12*S, 3*S, 10*S);
  gfx.fillStyle(0x004422, 1);
  gfx.fillRect(11*S, 26*S, 4*S, 5*S);
  gfx.fillRect(17*S, 26*S, 4*S, 5*S);
  gfx.generateTexture('player_self', T, T);

  // Other player — blue suit
  gfx.clear();
  gfx.fillStyle(0x224466, 1);
  gfx.fillRect(10*S, 10*S, 12*S, 16*S);
  gfx.fillStyle(0x4488ff, 1);
  gfx.fillRect(11*S, 4*S, 10*S, 10*S);
  gfx.fillStyle(0x88bbff, 1);
  gfx.fillRect(13*S, 6*S, 6*S, 4*S);
  gfx.fillStyle(0x1a3355, 1);
  gfx.fillRect(7*S, 12*S, 3*S, 10*S);
  gfx.fillRect(22*S, 12*S, 3*S, 10*S);
  gfx.fillStyle(0x112244, 1);
  gfx.fillRect(11*S, 26*S, 4*S, 5*S);
  gfx.fillRect(17*S, 26*S, 4*S, 5*S);
  gfx.generateTexture('player_other', T, T);

  // Sheep
  gfx.clear();
  gfx.fillStyle(0xddddcc, 1);
  gfx.fillEllipse(16*S, 16*S, 22*S, 16*S);
  gfx.fillStyle(0xeeeedd, 1);
  gfx.fillCircle(12*S, 13*S, 4*S);
  gfx.fillCircle(18*S, 11*S, 4*S);
  gfx.fillCircle(20*S, 15*S, 3*S);
  gfx.fillCircle(14*S, 17*S, 3*S);
  gfx.fillStyle(0x888877, 1);
  gfx.fillEllipse(6*S, 12*S, 8*S, 7*S);
  gfx.fillStyle(0x222222, 1);
  gfx.fillCircle(5*S, 11*S, 1.5*S);
  gfx.fillStyle(0x665544, 1);
  gfx.fillRect(10*S, 22*S, 2*S, 6*S);
  gfx.fillRect(15*S, 22*S, 2*S, 6*S);
  gfx.fillRect(19*S, 22*S, 2*S, 6*S);
  gfx.fillRect(23*S, 22*S, 2*S, 6*S);
  gfx.generateTexture('npc_sheep', T, T);

  gfx.destroy();
}

export function generateNPCTextures(scene) {
  // Already generated in generatePlayerTextures above
  // This function exists for future animal types
}

export const TILE_SIZE = T;
