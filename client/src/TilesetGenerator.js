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
  // Stone brick wall with mortar lines, highlight/shadow per brick
  const brickH = Math.floor(T / 4);
  const brickW = Math.floor(T / 2);
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2) * Math.floor(brickW / 2);
    for (let col = -1; col < 3; col++) {
      const bx = x + col * brickW + offset;
      const by = y + row * brickH;
      const shade = 68 + (rng() * 20) | 0;
      // Brick fill with dither
      for (let py = 0; py < brickH - 1; py++) {
        for (let px = 0; px < brickW - 1; px++) {
          const rx = bx + px, ry = by + py;
          if (rx < x || rx >= x + T || ry < y || ry >= y + T) continue;
          const d = ((px + py) % 2 === 0) ? 3 : 0;
          const hl = py < 2 ? 10 : py > brickH - 4 ? -8 : 0;
          ctx.fillStyle = rgbStr(shade + hl + d, shade - 4 + hl + d, shade - 10 + hl);
          ctx.fillRect(rx, ry, 1, 1);
        }
      }
    }
    // Mortar lines
    ctx.fillStyle = 'rgba(40,38,35,0.8)';
    ctx.fillRect(x, y + row * brickH + brickH - 1, T, 1);
    for (let col = -1; col < 3; col++) {
      const mx = x + col * brickW + offset + brickW - 1;
      if (mx >= x && mx < x + T) ctx.fillRect(mx, y + row * brickH, 1, brickH);
    }
  }
  // Edge shading
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, T, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x, y + T - 2, T, 2);
}

function paintFloor(ctx, x, y, rng) {
  // Cobblestone path — scaled for 64px
  const dirt = { r: 72, g: 58, b: 40 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, dirt.r, 6), vary(rng, dirt.g, 5), vary(rng, dirt.b, 4));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Generate cobblestones scaled to T
  const S = T / 32;
  const stones = [
    [2, 2, 8, 6], [11, 1, 7, 7], [20, 2, 9, 6],
    [1, 10, 9, 7], [12, 9, 8, 8], [22, 10, 8, 6],
    [3, 19, 7, 7], [12, 18, 9, 6], [23, 19, 7, 7],
    [1, 27, 8, 4], [11, 26, 8, 5], [21, 27, 9, 4],
  ];
  for (const [sx, sy, sw, sh] of stones) {
    const shade = 88 + (rng() * 40) | 0;
    const ssx = Math.floor(sx * S), ssy = Math.floor(sy * S);
    const ssw = Math.floor(sw * S), ssh = Math.floor(sh * S);
    for (let py = 0; py < ssh; py++) {
      for (let px = 0; px < ssw; px++) {
        const corner = (px < 2 && py < 2) || (px >= ssw-2 && py < 2) ||
                       (px < 2 && py >= ssh-2) || (px >= ssw-2 && py >= ssh-2);
        if (corner) continue;
        const hl = py < 3 ? 14 : py > ssh - 3 ? -12 : 0;
        const d = ((px + py) % 2 === 0) ? 4 : 0;
        ctx.fillStyle = rgbStr(shade + hl + d, shade - 6 + hl + d, shade - 12 + hl);
        ctx.fillRect(x + ssx + px, y + ssy + py, 1, 1);
      }
    }
  }
  ctx.strokeStyle = 'rgba(180,170,140,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

function paintChest(ctx, x, y, rng, baseR, baseG, baseB) {
  paintDirt(ctx, x, y, rng);
  const S = T / 32;
  const cx2 = x + Math.floor(5*S), cy2 = y + Math.floor(10*S);
  const cw = Math.floor(22*S), ch = Math.floor(16*S);
  const lidH = Math.floor(6*S);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(cx2 + 2, cy2 + ch, cw, Math.floor(3*S));
  // Body
  ctx.fillStyle = rgbStr(baseR - 10, baseG - 10, baseB - 8);
  ctx.fillRect(cx2, cy2, cw, ch);
  // Lid
  ctx.fillStyle = rgbStr(baseR + 15, baseG + 15, baseB + 10);
  ctx.fillRect(cx2, cy2, cw, lidH);
  // Highlight on lid
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(cx2 + 2, cy2 + 1, cw - 4, Math.floor(2*S));
  // Border
  ctx.strokeStyle = rgbStr(baseR - 35, baseG - 35, baseB - 30);
  ctx.lineWidth = S;
  ctx.strokeRect(cx2 + 0.5, cy2 + 0.5, cw - 1, ch - 1);
  // Lid line
  ctx.fillStyle = rgbStr(baseR - 25, baseG - 25, baseB - 20);
  ctx.fillRect(cx2 + 1, cy2 + lidH - 1, cw - 2, S);
  // Lock
  const lockW = Math.floor(4*S), lockH = Math.floor(4*S);
  const lockX = cx2 + (cw - lockW) / 2, lockY = cy2 + lidH - Math.floor(2*S);
  ctx.fillStyle = rgbStr(210, 190, 90);
  ctx.fillRect(lockX, lockY, lockW, lockH);
  ctx.fillStyle = rgbStr(170, 150, 60);
  ctx.fillRect(lockX + S, lockY + S, lockW - 2*S, lockH - 2*S);
  // Bottom shadow
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(cx2, cy2 + ch - S, cw, S);
}

function paintSign(ctx, x, y, rng) {
  paintDirt(ctx, x, y, rng);
  const S = T / 32;
  // Post
  const postX = x + Math.floor(13*S), postW = Math.floor(6*S);
  ctx.fillStyle = rgbStr(85, 60, 30);
  ctx.fillRect(postX, y + Math.floor(10*S), postW, Math.floor(22*S));
  // Post highlight
  ctx.fillStyle = rgbStr(100, 75, 42);
  ctx.fillRect(postX, y + Math.floor(10*S), Math.floor(2*S), Math.floor(22*S));
  // Board
  const bx = x + Math.floor(4*S), by = y + Math.floor(4*S);
  const bw = Math.floor(24*S), bh = Math.floor(16*S);
  ctx.fillStyle = rgbStr(160, 125, 68);
  ctx.fillRect(bx, by, bw, bh);
  // Board edge shading
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(bx, by, bw, S);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(bx, by + bh - S, bw, S);
  ctx.strokeStyle = rgbStr(95, 70, 35);
  ctx.lineWidth = S;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  // Text lines
  ctx.fillStyle = rgbStr(55, 40, 22);
  for (let i = 0; i < 3; i++) {
    const lw = bw - Math.floor((6 + i * 4) * S);
    ctx.fillRect(bx + Math.floor(3*S), by + Math.floor((4 + i * 4) * S), lw, S);
  }
}

function paintMachine(ctx, x, y, rng, color, symbol) {
  const c = hexToRgb(color);
  const S = T / 32;
  // Metal body with gradient
  for (let py = 0; py < T; py++) {
    const grad = (py / T - 0.5) * 30;
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, c.r - grad, 5) + d,
        vary(rng, c.g - grad, 5) + d,
        vary(rng, c.b - grad, 4) + d
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Border — double line
  ctx.strokeStyle = rgbStr(c.r * 0.5, c.g * 0.5, c.b * 0.5);
  ctx.lineWidth = S;
  ctx.strokeRect(x + S, y + S, T - 2*S, T - 2*S);
  ctx.strokeStyle = rgbStr(c.r * 0.7, c.g * 0.7, c.b * 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2*S, y + 2*S, T - 4*S, T - 4*S);
  // Corner bolts
  const boltR = Math.floor(2*S);
  for (const [bx2, by2] of [[4*S, 4*S], [T-4*S, 4*S], [4*S, T-4*S], [T-4*S, T-4*S]]) {
    ctx.fillStyle = rgbStr(c.r * 0.4, c.g * 0.4, c.b * 0.4);
    ctx.fillRect(x + bx2 - boltR/2, y + by2 - boltR/2, boltR, boltR);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x + bx2 - boltR/2, y + by2 - boltR/2, boltR, 1);
  }
  // Center symbol
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(14*S)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, x + T / 2, y + T / 2 + S);
  // Top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 3*S, y + S, T - 6*S, 2*S);
}

function paintStairsDown(ctx, x, y, rng) {
  const S = T / 32;
  // Stone base
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(vary(rng, 68 + d, 5), vary(rng, 63 + d, 5), vary(rng, 56, 4));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  const steps = 6;
  const stepH = Math.floor(T / steps);
  for (let i = 0; i < steps; i++) {
    const shade = 85 - i * 10;
    const sy = y + i * stepH;
    const indent = Math.floor(i * 2 * S);
    ctx.fillStyle = rgbStr(shade, shade - 5, shade - 12);
    ctx.fillRect(x + indent, sy, T - indent * 2, stepH - S);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + indent, sy, T - indent * 2, S);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + indent, sy + stepH - S, T - indent * 2, S);
  }
  // Down arrow
  const ax = T / 2, ay = Math.floor(6 * S);
  ctx.fillStyle = 'rgba(255,200,80,0.8)';
  ctx.fillRect(x + ax - 2*S, y + ay, 4*S, 6*S);
  ctx.fillRect(x + ax - 4*S, y + ay + 6*S, 8*S, 2*S);
  ctx.fillRect(x + ax - 2*S, y + ay + 8*S, 4*S, 2*S);
}

function paintStairsUp(ctx, x, y, rng) {
  const S = T / 32;
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 3 : 0;
      ctx.fillStyle = rgbStr(vary(rng, 68 + d, 5), vary(rng, 63 + d, 5), vary(rng, 56, 4));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  const steps = 6;
  const stepH = Math.floor(T / steps);
  for (let i = 0; i < steps; i++) {
    const shade = 38 + i * 10;
    const sy = y + i * stepH;
    const indent = Math.floor((steps - 1 - i) * 2 * S);
    ctx.fillStyle = rgbStr(shade, shade - 5, shade - 12);
    ctx.fillRect(x + indent, sy, T - indent * 2, stepH - S);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + indent, sy, T - indent * 2, S);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + indent, sy + stepH - S, T - indent * 2, S);
  }
  const ax = T / 2, ay = Math.floor(6 * S);
  ctx.fillStyle = 'rgba(80,220,255,0.8)';
  ctx.fillRect(x + ax - 2*S, y + ay + 4*S, 4*S, 6*S);
  ctx.fillRect(x + ax - 4*S, y + ay + 2*S, 8*S, 2*S);
  ctx.fillRect(x + ax - 2*S, y + ay, 4*S, 2*S);
}

function paintFarmPlot(ctx, x, y, rng) {
  const S = T / 32;
  // Rich tilled soil
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const d = ((px + py) % 2 === 0) ? 4 : 0;
      ctx.fillStyle = rgbStr(vary(rng, 68 + d, 6), vary(rng, 48 + d, 5), vary(rng, 22, 4));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Furrow lines — more rows for 64px
  const furrows = Math.floor(T / (4 * S));
  for (let row = 0; row < furrows; row++) {
    const fy = y + Math.floor(3*S) + row * Math.floor(4*S);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + Math.floor(2*S), fy, T - Math.floor(4*S), S);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + Math.floor(2*S), fy + S, T - Math.floor(4*S), S);
  }
  ctx.strokeStyle = 'rgba(100,80,40,0.35)';
  ctx.lineWidth = S;
  ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

function paintFarmGrowing(ctx, x, y, rng) {
  paintFarmPlot(ctx, x, y, rng);
  const S = T / 32;
  // Seedlings — more and taller for 64px
  for (let i = 0; i < 12; i++) {
    const sx = (rng() * (T - 10*S) + 5*S) | 0;
    const sy = (rng() * (T * 0.4) + T * 0.45) | 0;
    const h = Math.floor((rng() * 4 + 3) * S);
    // Stem
    ctx.fillStyle = rgbStr(45 + rng() * 30, 90 + rng() * 40, 28);
    ctx.fillRect(x + sx, y + sy - h, S, h);
    // Leaves
    ctx.fillStyle = rgbStr(55 + rng() * 25, 115 + rng() * 35, 35);
    ctx.fillRect(x + sx - S, y + sy - h - S, 3*S, 2*S);
  }
}

function paintFarmReady(ctx, x, y, rng) {
  paintFarmPlot(ctx, x, y, rng);
  const S = T / 32;
  // Tall golden wheat
  for (let i = 0; i < 16; i++) {
    const sx = (rng() * (T - 8*S) + 4*S) | 0;
    const sy = (rng() * (T * 0.25) + T * 0.55) | 0;
    const h = Math.floor((rng() * 6 + 10) * S);
    // Stalk
    ctx.fillStyle = rgbStr(155 + rng() * 35, 135 + rng() * 25, 35);
    ctx.fillRect(x + sx, y + sy - h, S, h);
    // Wheat head — larger
    ctx.fillStyle = rgbStr(200 + rng() * 45, 175 + rng() * 35, 45);
    ctx.fillRect(x + sx - S, y + sy - h - 3*S, 3*S, 4*S);
    // Highlight
    ctx.fillStyle = rgbStr(230, 210, 85);
    ctx.fillRect(x + sx, y + sy - h - 3*S, S, S);
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

function _drawColonist(gfx, S, colors) {
  // Detailed sci-fi colonist sprite
  // colors: { suit, suitDark, suitLight, helmet, visor, boots, skin, outline }
  const cx = 16 * S; // center x
  const o = colors.outline;

  // Drop shadow
  gfx.fillStyle(0x000000, 0.2);
  gfx.fillEllipse(cx, 29 * S, 14 * S, 4 * S);

  // ── Boots ──
  gfx.fillStyle(colors.boots, 1);
  gfx.fillRect((11)*S, (26)*S, (5)*S, (4)*S);  // left boot
  gfx.fillRect((16)*S, (26)*S, (5)*S, (4)*S);  // right boot
  // Boot highlight
  gfx.fillStyle(0xffffff, 0.1);
  gfx.fillRect((11)*S, (26)*S, (5)*S, S);
  gfx.fillRect((16)*S, (26)*S, (5)*S, S);
  // Boot sole
  gfx.fillStyle(0x000000, 0.3);
  gfx.fillRect((11)*S, (29)*S, (5)*S, S);
  gfx.fillRect((16)*S, (29)*S, (5)*S, S);

  // ── Legs ──
  gfx.fillStyle(colors.suitDark, 1);
  gfx.fillRect((12)*S, (22)*S, (4)*S, (5)*S);   // left leg
  gfx.fillRect((16)*S, (22)*S, (4)*S, (5)*S);   // right leg
  // Inner leg shadow
  gfx.fillStyle(0x000000, 0.15);
  gfx.fillRect((15)*S, (22)*S, (2)*S, (5)*S);

  // ── Torso ──
  gfx.fillStyle(colors.suit, 1);
  gfx.fillRect((10)*S, (13)*S, (12)*S, (10)*S);
  // Chest highlight
  gfx.fillStyle(colors.suitLight, 1);
  gfx.fillRect((11)*S, (14)*S, (4)*S, (3)*S);
  // Belt
  gfx.fillStyle(colors.suitDark, 1);
  gfx.fillRect((10)*S, (22)*S, (12)*S, (2)*S);
  // Belt buckle
  gfx.fillStyle(0xccaa44, 1);
  gfx.fillRect((15)*S, (22)*S, (2)*S, (2)*S);
  // Chest panel / badge
  gfx.fillStyle(0xffffff, 0.15);
  gfx.fillRect((17)*S, (15)*S, (3)*S, (3)*S);
  gfx.fillStyle(colors.visorColor || colors.visor, 0.4);
  gfx.fillRect((17)*S, (15)*S, (3)*S, (1)*S);

  // ── Arms ──
  // Left arm
  gfx.fillStyle(colors.suit, 1);
  gfx.fillRect((7)*S, (14)*S, (3)*S, (8)*S);
  gfx.fillStyle(colors.suitDark, 1);
  gfx.fillRect((7)*S, (14)*S, S, (8)*S); // outer shadow
  // Left hand
  gfx.fillStyle(colors.skin, 1);
  gfx.fillRect((7)*S, (22)*S, (3)*S, (2)*S);
  // Right arm
  gfx.fillStyle(colors.suit, 1);
  gfx.fillRect((22)*S, (14)*S, (3)*S, (8)*S);
  gfx.fillStyle(colors.suitLight, 1);
  gfx.fillRect((24)*S, (14)*S, S, (8)*S); // outer highlight
  // Right hand
  gfx.fillStyle(colors.skin, 1);
  gfx.fillRect((22)*S, (22)*S, (3)*S, (2)*S);
  // Shoulder pads
  gfx.fillStyle(colors.suitLight, 1);
  gfx.fillRect((8)*S, (13)*S, (4)*S, (2)*S);
  gfx.fillRect((20)*S, (13)*S, (4)*S, (2)*S);

  // ── Helmet ──
  gfx.fillStyle(colors.helmet, 1);
  gfx.fillRoundedRect((10)*S, (3)*S, (12)*S, (11)*S, 3*S);
  // Helmet highlight
  gfx.fillStyle(0xffffff, 0.12);
  gfx.fillRect((11)*S, (4)*S, (6)*S, (2)*S);
  // Helmet shadow
  gfx.fillStyle(0x000000, 0.15);
  gfx.fillRect((10)*S, (12)*S, (12)*S, (2)*S);

  // ── Visor ──
  gfx.fillStyle(colors.visor, 1);
  gfx.fillRoundedRect((12)*S, (6)*S, (8)*S, (5)*S, 2*S);
  // Visor reflection
  gfx.fillStyle(0xffffff, 0.25);
  gfx.fillRect((13)*S, (7)*S, (3)*S, (2)*S);
  // Visor bottom glow
  gfx.fillStyle(colors.visor, 0.3);
  gfx.fillRect((13)*S, (11)*S, (6)*S, S);

  // ── Antenna ──
  gfx.fillStyle(colors.suitDark, 1);
  gfx.fillRect((20)*S, (1)*S, S, (3)*S);
  gfx.fillStyle(0xff4444, 1);
  gfx.fillCircle((20.5)*S, (1)*S, S);

  // ── Outline (subtle dark edge) ──
  gfx.lineStyle(S * 0.5, o, 0.4);
  // Head outline
  gfx.strokeRoundedRect((10)*S, (3)*S, (12)*S, (11)*S, 3*S);
  // Body outline
  gfx.strokeRect((10)*S, (13)*S, (12)*S, (11)*S);
}

export function generatePlayerTextures(scene) {
  const gfx = scene.add.graphics();
  const S = T / 32;

  // Self player — green sci-fi suit
  gfx.clear();
  _drawColonist(gfx, S, {
    suit: 0x007755, suitDark: 0x005544, suitLight: 0x22aa77,
    helmet: 0x00cc66, visor: 0x88ffcc, visorColor: 0x44ffaa,
    boots: 0x334433, skin: 0xddbb99, outline: 0x002211,
  });
  gfx.generateTexture('player_self', T, T);

  // Other player — blue suit
  gfx.clear();
  _drawColonist(gfx, S, {
    suit: 0x2255aa, suitDark: 0x1a3366, suitLight: 0x4488cc,
    helmet: 0x3377dd, visor: 0x88ccff, visorColor: 0x66bbff,
    boots: 0x2a2a44, skin: 0xddbb99, outline: 0x0a1133,
  });
  gfx.generateTexture('player_other', T, T);

  // Sheep — improved with more wool detail
  gfx.clear();
  // Shadow
  gfx.fillStyle(0x000000, 0.15);
  gfx.fillEllipse(16*S, 26*S, 20*S, 4*S);
  // Body (wool)
  gfx.fillStyle(0xddddcc, 1);
  gfx.fillEllipse(16*S, 16*S, 22*S, 16*S);
  // Wool bumps
  gfx.fillStyle(0xeeeedd, 1);
  gfx.fillCircle(11*S, 12*S, 5*S);
  gfx.fillCircle(18*S, 10*S, 5*S);
  gfx.fillCircle(21*S, 14*S, 4*S);
  gfx.fillCircle(13*S, 17*S, 4*S);
  gfx.fillCircle(16*S, 19*S, 3*S);
  // Wool shadow
  gfx.fillStyle(0xbbbbaa, 1);
  gfx.fillCircle(14*S, 20*S, 4*S);
  gfx.fillCircle(20*S, 18*S, 3*S);
  // Head
  gfx.fillStyle(0x888877, 1);
  gfx.fillEllipse(6*S, 12*S, 9*S, 8*S);
  // Ear
  gfx.fillStyle(0x776666, 1);
  gfx.fillEllipse(3*S, 8*S, 4*S, 3*S);
  // Eye
  gfx.fillStyle(0x222222, 1);
  gfx.fillCircle(5*S, 11*S, 1.5*S);
  gfx.fillStyle(0xffffff, 1);
  gfx.fillCircle(4.5*S, 10.5*S, 0.5*S);
  // Nose
  gfx.fillStyle(0x665555, 1);
  gfx.fillCircle(2.5*S, 13*S, S);
  // Legs
  gfx.fillStyle(0x554433, 1);
  gfx.fillRect(9*S, 22*S, 3*S, 7*S);
  gfx.fillRect(14*S, 22*S, 3*S, 7*S);
  gfx.fillRect(18*S, 22*S, 3*S, 7*S);
  gfx.fillRect(23*S, 22*S, 3*S, 7*S);
  // Hooves
  gfx.fillStyle(0x332211, 1);
  gfx.fillRect(9*S, 28*S, 3*S, S);
  gfx.fillRect(14*S, 28*S, 3*S, S);
  gfx.fillRect(18*S, 28*S, 3*S, S);
  gfx.fillRect(23*S, 28*S, 3*S, S);
  gfx.generateTexture('npc_sheep', T, T);

  gfx.destroy();
}

export function generateNPCTextures(scene) {
  // Already generated in generatePlayerTextures above
  // This function exists for future animal types
}

export const TILE_SIZE = T;
