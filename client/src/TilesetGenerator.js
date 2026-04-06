/**
 * Procedural pixel-art tileset generator.
 * Draws a spritesheet of 32x32 tiles to a canvas with texture, shading, and detail.
 */

const T = 32; // tile size

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

// ── Individual tile painters ──

function paintDeepWater(ctx, x, y, rng) {
  const base = { r: 18, g: 32, b: 62 };
  // Dark water with subtle ripples
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave = Math.sin((px + py * 0.5) * 0.4) * 8;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r + wave, 10),
        vary(rng, base.g + wave, 10),
        vary(rng, base.b + wave * 1.5, 15)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintWater(ctx, x, y, rng) {
  const base = { r: 34, g: 62, b: 102 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave = Math.sin((px * 0.3 + py * 0.2)) * 12;
      const sparkle = rng() > 0.96 ? 30 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r + wave, 8) + sparkle,
        vary(rng, base.g + wave, 8) + sparkle,
        vary(rng, base.b + wave * 1.5, 12) + sparkle
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function paintSand(ctx, x, y, rng) {
  const base = { r: 194, g: 178, b: 128 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const grain = rng() > 0.85 ? 15 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r, 12) + grain,
        vary(rng, base.g, 10) + grain,
        vary(rng, base.b, 14)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Occasional pebble
  if (rng() > 0.5) {
    ctx.fillStyle = rgbStr(160, 150, 110);
    const px = (rng() * 24 + 4) | 0;
    const py = (rng() * 24 + 4) | 0;
    ctx.fillRect(x + px, y + py, 2, 2);
  }
}

function paintDirt(ctx, x, y, rng, baseR = 90, baseG = 65, baseB = 38) {
  const base = { r: baseR, g: baseG, b: baseB };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(
        vary(rng, base.r, 16),
        vary(rng, base.g, 12),
        vary(rng, base.b, 10)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Small rocks
  for (let i = 0; i < 3; i++) {
    if (rng() > 0.4) {
      ctx.fillStyle = rgbStr(70 + rng() * 20, 55 + rng() * 15, 35 + rng() * 10);
      ctx.fillRect(x + (rng() * 28 + 2) | 0, y + (rng() * 28 + 2) | 0, 2, 1);
    }
  }
}

function paintAlienGrass(ctx, x, y, rng) {
  // Purple-green alien grass
  const base = { r: 42, g: 88, b: 48 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const tint = rng() > 0.9 ? 12 : 0; // occasional bright spot
      ctx.fillStyle = rgbStr(
        vary(rng, base.r, 14) + tint,
        vary(rng, base.g, 18) + tint,
        vary(rng, base.b + (rng() > 0.8 ? 15 : 0), 12)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Grass blades
  for (let i = 0; i < 6; i++) {
    const gx = (rng() * 28 + 2) | 0;
    const gy = (rng() * 20 + 8) | 0;
    ctx.fillStyle = rgbStr(50 + rng() * 20, 110 + rng() * 30, 55 + rng() * 20);
    ctx.fillRect(x + gx, y + gy, 1, 3);
    ctx.fillRect(x + gx, y + gy - 1, 1, 1);
  }
}

function paintRock(ctx, x, y, rng) {
  const base = { r: 95, g: 95, b: 90 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const crack = (Math.abs(Math.sin(px * 1.2 + py * 0.8)) < 0.1) ? -15 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r + crack, 12),
        vary(rng, base.g + crack, 12),
        vary(rng, base.b + crack, 10)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Highlight edge
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, T, 2);
  ctx.fillRect(x, y, 2, T);
  // Shadow edge
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(x, y + T - 2, T, 2);
  ctx.fillRect(x + T - 2, y, 2, T);
}

function paintDenseRock(ctx, x, y, rng, baseR = 58, baseG = 56, baseB = 54) {
  const base = { r: baseR, g: baseG, b: baseB };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(
        vary(rng, base.r, 8),
        vary(rng, base.g, 8),
        vary(rng, base.b, 8)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 4);
  ctx.lineTo(x + 16, y + 14);
  ctx.lineTo(x + 24, y + 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 20);
  ctx.lineTo(x + 14, y + 26);
  ctx.stroke();
  // Highlight/shadow
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x, y, T, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x, y + T - 2, T, 2);
}

function paintOre(ctx, x, y, rng, oreColor) {
  // Rock base
  const base = { r: 80, g: 78, b: 74 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(
        vary(rng, base.r, 10),
        vary(rng, base.g, 10),
        vary(rng, base.b, 8)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Ore veins
  const oc = hexToRgb(oreColor);
  for (let i = 0; i < 8; i++) {
    const vx = (rng() * 24 + 4) | 0;
    const vy = (rng() * 24 + 4) | 0;
    const size = (rng() * 3 + 2) | 0;
    ctx.fillStyle = rgbStr(oc.r, oc.g, oc.b, 0.9);
    ctx.fillRect(x + vx, y + vy, size, size - 1);
    // Sparkle
    ctx.fillStyle = rgbStr(
      Math.min(255, oc.r + 60),
      Math.min(255, oc.g + 60),
      Math.min(255, oc.b + 60)
    );
    ctx.fillRect(x + vx + 1, y + vy, 1, 1);
  }
}

function paintAlienFlora(ctx, x, y, rng) {
  // Grass base
  paintAlienGrass(ctx, x, y, rng);
  // Alien plants — bioluminescent
  for (let i = 0; i < 3; i++) {
    const px = (rng() * 22 + 5) | 0;
    const py = (rng() * 16 + 10) | 0;
    const h = (rng() * 6 + 4) | 0;
    // Stem
    ctx.fillStyle = rgbStr(30, 100 + rng() * 40, 50);
    ctx.fillRect(x + px, y + py - h, 1, h);
    // Glowing top
    ctx.fillStyle = rgbStr(40 + rng() * 30, 200 + rng() * 55, 100 + rng() * 40);
    ctx.fillRect(x + px - 1, y + py - h - 1, 3, 2);
    // Glow effect
    ctx.fillStyle = 'rgba(60,255,140,0.08)';
    ctx.fillRect(x + px - 3, y + py - h - 3, 7, 6);
  }
}

function paintAlienTree(ctx, x, y, rng) {
  // Grass base
  paintAlienGrass(ctx, x, y, rng);
  // Trunk
  const trunkX = 12 + (rng() * 8) | 0;
  const trunkW = 4 + (rng() * 3) | 0;
  const trunkH = 12 + (rng() * 6) | 0;
  ctx.fillStyle = rgbStr(50 + rng() * 20, 35 + rng() * 15, 20 + rng() * 10);
  ctx.fillRect(x + trunkX, y + T - trunkH, trunkW, trunkH);
  // Bark detail
  ctx.fillStyle = rgbStr(35, 25, 15);
  ctx.fillRect(x + trunkX + 1, y + T - trunkH + 3, 1, 2);
  ctx.fillRect(x + trunkX + 2, y + T - trunkH + 7, 1, 2);
  // Canopy — alien purple-green
  const canopyR = 8 + (rng() * 4) | 0;
  const canopyCX = trunkX + trunkW / 2;
  const canopyCY = T - trunkH - canopyR + 4;
  for (let dy = -canopyR; dy <= canopyR; dy++) {
    for (let dx = -canopyR; dx <= canopyR; dx++) {
      if (dx * dx + dy * dy <= canopyR * canopyR) {
        const px = x + canopyCX + dx;
        const py = y + canopyCY + dy;
        if (px >= x && px < x + T && py >= y && py < y + T) {
          ctx.fillStyle = rgbStr(
            20 + rng() * 30,
            80 + rng() * 60 + (dy < 0 ? 15 : 0),
            40 + rng() * 40 + (rng() > 0.85 ? 30 : 0)
          );
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
  // Highlight on top of canopy
  ctx.fillStyle = 'rgba(100,255,120,0.1)';
  ctx.fillRect(x + canopyCX - 3, y + canopyCY - canopyR, 6, 3);
}

function paintCrystal(ctx, x, y, rng, crystalColor = null) {
  const cc = crystalColor ? hexToRgb(crystalColor) : null;
  // Dark ground base
  const base = { r: 35, g: 40, b: 50 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      ctx.fillStyle = rgbStr(vary(rng, base.r, 8), vary(rng, base.g, 8), vary(rng, base.b, 10));
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Crystal formations
  for (let i = 0; i < 4; i++) {
    const cx = (rng() * 20 + 6) | 0;
    const cy = (rng() * 14 + 12) | 0;
    const h = (rng() * 8 + 5) | 0;
    const w = (rng() * 2 + 2) | 0;
    // Crystal body
    const bright = 160 + rng() * 80;
    ctx.fillStyle = cc
      ? rgbStr(cc.r * (bright/255), cc.g * (bright/255), cc.b * (bright/255))
      : rgbStr(bright * 0.5, bright * 0.8, bright);
    ctx.fillRect(x + cx, y + cy - h, w, h);
    // Tip
    ctx.fillStyle = rgbStr(200, 230, 255);
    ctx.fillRect(x + cx, y + cy - h, w, 1);
    // Glow
    ctx.fillStyle = 'rgba(120,200,240,0.1)';
    ctx.fillRect(x + cx - 2, y + cy - h - 2, w + 4, h + 4);
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
  canvas2.width = T * (tileCount + 13); // +storage, furnace, 4 chests, 5 underground, 2 stairs
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
  100: 12, 101: 13, 102: 14, 103: 28, 104: 29,
  200: 15, 201: 16, 202: 17, 203: 18,
  204: 19, 205: 20, 206: 21, 207: 22,
};

export function getTileIndex(tileId) {
  return TILE_INDEX_MAP[tileId] ?? 3; // default to dirt
}

export function generatePlayerTextures(scene) {
  const gfx = scene.add.graphics();

  // Self player — green sci-fi suit
  gfx.clear();
  // Body
  gfx.fillStyle(0x006644, 1);
  gfx.fillRect(10, 10, 12, 16); // torso
  // Helmet
  gfx.fillStyle(0x00ff88, 1);
  gfx.fillRect(11, 4, 10, 10);
  gfx.fillStyle(0x88ffcc, 1);
  gfx.fillRect(13, 6, 6, 4); // visor
  // Arms
  gfx.fillStyle(0x005533, 1);
  gfx.fillRect(7, 12, 3, 10);
  gfx.fillRect(22, 12, 3, 10);
  // Legs
  gfx.fillStyle(0x004422, 1);
  gfx.fillRect(11, 26, 4, 5);
  gfx.fillRect(17, 26, 4, 5);
  gfx.generateTexture('player_self', 32, 32);

  // Other player — blue suit
  gfx.clear();
  gfx.fillStyle(0x224466, 1);
  gfx.fillRect(10, 10, 12, 16);
  gfx.fillStyle(0x4488ff, 1);
  gfx.fillRect(11, 4, 10, 10);
  gfx.fillStyle(0x88bbff, 1);
  gfx.fillRect(13, 6, 6, 4);
  gfx.fillStyle(0x1a3355, 1);
  gfx.fillRect(7, 12, 3, 10);
  gfx.fillRect(22, 12, 3, 10);
  gfx.fillStyle(0x112244, 1);
  gfx.fillRect(11, 26, 4, 5);
  gfx.fillRect(17, 26, 4, 5);
  gfx.generateTexture('player_other', 32, 32);

  // Sheep — fluffy white blob with legs and face
  gfx.clear();
  // Body (wool)
  gfx.fillStyle(0xddddcc, 1);
  gfx.fillEllipse(16, 16, 22, 16);
  // Wool texture bumps
  gfx.fillStyle(0xeeeedd, 1);
  gfx.fillCircle(12, 13, 4);
  gfx.fillCircle(18, 11, 4);
  gfx.fillCircle(20, 15, 3);
  gfx.fillCircle(14, 17, 3);
  // Head
  gfx.fillStyle(0x888877, 1);
  gfx.fillEllipse(6, 12, 8, 7);
  // Eye
  gfx.fillStyle(0x222222, 1);
  gfx.fillCircle(5, 11, 1.5);
  // Legs
  gfx.fillStyle(0x665544, 1);
  gfx.fillRect(10, 22, 2, 6);
  gfx.fillRect(15, 22, 2, 6);
  gfx.fillRect(19, 22, 2, 6);
  gfx.fillRect(23, 22, 2, 6);
  gfx.generateTexture('npc_sheep', 32, 32);

  gfx.destroy();
}

export function generateNPCTextures(scene) {
  // Already generated in generatePlayerTextures above
  // This function exists for future animal types
}

export const TILE_SIZE = T;
