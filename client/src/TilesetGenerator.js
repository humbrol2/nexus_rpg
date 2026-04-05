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

function paintDirt(ctx, x, y, rng) {
  const base = { r: 90, g: 65, b: 38 };
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

function paintDenseRock(ctx, x, y, rng) {
  const base = { r: 58, g: 56, b: 54 };
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

function paintCrystal(ctx, x, y, rng) {
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
    ctx.fillStyle = rgbStr(bright * 0.5, bright * 0.8, bright);
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
  const base = { r: 100, g: 100, b: 110 };
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const grid = (px % 16 < 1 || py % 16 < 1) ? -10 : 0;
      ctx.fillStyle = rgbStr(
        vary(rng, base.r + grid, 4),
        vary(rng, base.g + grid, 4),
        vary(rng, base.b + grid, 5)
      );
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
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

// ── Main generator ──

export function generateTileset(scene) {
  const tileCount = 16; // 0-11 terrain + 100,101 build + 200-203 machines
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
    (x, y) => paintMachine(ctx, x, y, mulberry32(1400), 0xcc8833, 'M'),  // 14 -> 200 miner
    (x, y) => paintMachine(ctx, x, y, mulberry32(1500), 0x6688cc, 'F'),  // 15 -> 201 fabricator
  ];

  painters.forEach((paint, i) => paint(i * T, 0));

  // Add extra machine tiles by extending canvas
  const canvas2 = document.createElement('canvas');
  canvas2.width = T * (tileCount + 2);
  canvas2.height = T;
  const ctx2 = canvas2.getContext('2d');
  ctx2.drawImage(canvas, 0, 0);

  // Storage (index 16 -> 202)
  paintMachine(ctx2, 16 * T, 0, mulberry32(1600), 0x886644, 'S');
  // Furnace (index 17 -> 203)
  paintMachine(ctx2, 17 * T, 0, mulberry32(1700), 0xcc4422, 'Fu');

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
  100: 12, 101: 13,
  200: 14, 201: 15, 202: 16, 203: 17,
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

  gfx.destroy();
}

export const TILE_SIZE = T;
