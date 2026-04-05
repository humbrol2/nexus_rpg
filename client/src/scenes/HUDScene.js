import Phaser from 'phaser';

const ITEM_INFO = {
  // Resources
  stone:        { color: '#888888', label: 'Stone' },
  iron_ore:     { color: '#8b5e3c', label: 'Iron Ore' },
  copper_ore:   { color: '#b87333', label: 'Copper Ore' },
  crystal:      { color: '#88ccee', label: 'Crystal' },
  biomass:      { color: '#2aaa5a', label: 'Biomass' },
  iron_plate:   { color: '#aaaacc', label: 'Iron Plate' },
  copper_plate: { color: '#ddaa66', label: 'Cu Plate' },
  iron_gear:    { color: '#8899aa', label: 'Iron Gear' },
  circuit:      { color: '#44cc88', label: 'Circuit' },
  wall_block:   { color: '#666677', label: 'Wall Blk' },
  wood:         { color: '#8b6b3a', label: 'Wood' },
  // Buildables (no inventory count — just toolbar actions)
  _build_wall:     { color: '#555566', label: 'Wall', buildable: true },
  _build_floor:    { color: '#777788', label: 'Floor', buildable: true },
  _build_miner:    { color: '#cc8833', label: 'Miner', buildable: true },
  _build_furnace:  { color: '#cc4422', label: 'Furnace', buildable: true },
  _build_fab:      { color: '#6688cc', label: 'Fabricatr', buildable: true },
  _build_storage:  { color: '#886644', label: 'Storage', buildable: true },
};

// Export for GameScene
export { ITEM_INFO };

export class HUDScene extends Phaser.Scene {
  constructor() {
    super('HUDScene');
    this.inventory = {};
    this.buildMode = null;
    this.hotbarCountTexts = [];
    // Toolbar: 10 assignable slots, each holds an item key or null
    this.toolbarSlots = [null, null, null, null, null, null, null, null, null, null];
    this.toolbarElements = [];
    this.activeToolbarSlot = -1;
    // Research
    this.researchTree = {};
    this.researchState = { completed: [], active: null, progress: 0 };
    this.researchOpen = false;
    this.researchElements = [];
    this.researchContainer = null;

    // Chat
    this.chatMessages = []; // [{name, text, t, alpha}]
    this.chatOpen = false;
    this.chatTexts = [];    // Phaser text objects on screen
    this._chatInput = null; // DOM input element

    // Drag state
    this._dragItem = null;
    this._dragIcon = null;
    this.machineUIOpen = false;
    this.machineUIData = null;
    this.machineUIElements = [];
    this.inventoryOpen = false;
    this.inventoryElements = [];
    this.craftingOpen = false;
    this.craftingElements = [];
    this.craftingContainer = null;

    // World map
    this.worldMapOpen = false;
    this.worldMapElements = [];

    // Minimap
    this.minimapVisible = true;
    this.minimapCanvas = null;
    this.minimapSprite = null;
    this.exploredChunks = {};  // "cx,cy" -> average color
    this.minimapSize = 180;
    this.minimapScale = 4;  // pixels per chunk on minimap
    this.playerPositions = [];  // [{x,y,id,isSelf}]
    this.machinePositions = []; // [{wx,wy}]
  }

  create() {

    // Coord text (top-left)
    this.coordText = this.add.text(10, 10, '', {
      fontSize: '14px', fontFamily: 'monospace',
      color: '#00ff88', backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    }).setDepth(1000);

    this.statusText = this.add.text(10, 36, 'Connecting...', {
      fontSize: '13px', fontFamily: 'monospace',
      color: '#ffaa00', backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    }).setDepth(1000);

    this.tileInfoText = this.add.text(10, 60, '', {
      fontSize: '12px', fontFamily: 'monospace',
      color: '#aaaacc', backgroundColor: '#000000aa',
      padding: { x: 6, y: 3 },
    }).setDepth(1000);

    // Toast
    this.toastText = this.add.text(
      this.cameras.main.width / 2, 80, '', {
        fontSize: '14px', fontFamily: 'monospace',
        color: '#ffffff', backgroundColor: '#33aa5588',
        padding: { x: 10, y: 6 },
      }
    ).setOrigin(0.5).setDepth(1001).setVisible(false);

    // Hotbar / Toolbar
    this._createHotbar();

    // Global drag tracking for inventory -> toolbar
    this.input.on('pointermove', (pointer) => {
      this.updateDrag(pointer);
    });
    this.input.on('pointerup', (pointer) => {
      if (this.isDragging()) {
        this.endDrag(pointer);
      }
      this._invDragKey = null;
    });

    // Minimap
    this._createMinimap();

    // Listen for resize
    this.scale.on('resize', (gameSize) => {
      this._repositionHotbar(gameSize.width, gameSize.height);
      this._repositionMinimap(gameSize.width, gameSize.height);
      this.toastText.setX(gameSize.width / 2);
    });
  }

  _buildHelpText() {
    return '[I]Inventory [C]Craft [M]Map | [E]Interact';
  }

  _createHotbar() {
    this._toolbarSlotSize = 52;
    this._toolbarPad = 4;
    this._renderToolbar();
  }

  _renderToolbar() {
    // Destroy old elements
    for (const el of this.toolbarElements) el.destroy();
    this.toolbarElements = [];

    const cam = this.cameras.main;
    const slotSize = this._toolbarSlotSize;
    const pad = this._toolbarPad;
    const slotCount = this.toolbarSlots.length;
    const barW = slotCount * (slotSize + pad) - pad + 24;
    const barH = slotSize + 28;
    const startX = (cam.width - barW) / 2;
    const y = cam.height - barH - 8;

    // Store for hit testing
    this._toolbarX = startX;
    this._toolbarY = y;
    this._toolbarW = barW;
    this._toolbarH = barH;

    // Background
    const bg = this.add.graphics().setDepth(900);
    bg.fillStyle(0x0a0e14, 0.85);
    bg.fillRoundedRect(startX, y, barW, barH, 8);
    bg.lineStyle(1, 0x00ff88, 0.15);
    bg.strokeRoundedRect(startX, y, barW, barH, 8);
    this.toolbarElements.push(bg);

    // Help text
    const helpText = this.add.text(startX + barW / 2, y + slotSize + 12, this._buildHelpText(), {
      fontSize: '9px', fontFamily: 'monospace', color: '#556666',
    }).setOrigin(0.5, 0).setDepth(901);
    this.toolbarElements.push(helpText);

    // Slots
    for (let i = 0; i < slotCount; i++) {
      const sx = startX + 12 + i * (slotSize + pad);
      const sy = y + 6;
      const itemKey = this.toolbarSlots[i];
      const info = itemKey ? ITEM_INFO[itemKey] : null;
      const count = itemKey ? (this.inventory[itemKey] || 0) : 0;
      const isActive = i === this.activeToolbarSlot;

      const slotGfx = this.add.graphics().setDepth(901);
      // Slot background
      if (isActive) {
        slotGfx.fillStyle(0x1a3322, 1);
        slotGfx.lineStyle(2, 0x00ff88, 0.8);
      } else if (info) {
        slotGfx.fillStyle(0x151a22, 1);
        slotGfx.lineStyle(1, 0x334455, 0.5);
      } else {
        slotGfx.fillStyle(0x0c0f14, 0.8);
        slotGfx.lineStyle(1, 0x1a1e28, 0.4);
      }
      slotGfx.fillRoundedRect(sx, sy, slotSize, slotSize, 4);
      slotGfx.strokeRoundedRect(sx, sy, slotSize, slotSize, 4);

      if (info) {
        const swatchHex = parseInt(info.color.replace('#', ''), 16);
        // Item icon
        const iconSize = 20;
        const iconX = sx + (slotSize - iconSize) / 2;
        const iconY = sy + 4;
        slotGfx.fillStyle(swatchHex, count > 0 ? 1 : 0.3);
        slotGfx.fillRoundedRect(iconX, iconY, iconSize, iconSize, 3);
        if (count > 0) {
          slotGfx.fillStyle(0xffffff, 0.15);
          slotGfx.fillRect(iconX + 2, iconY + 2, iconSize - 4, 4);
        }

        // Label
        const label = this.add.text(sx + slotSize / 2, sy + 27, info.label.slice(0, 6), {
          fontSize: '7px', fontFamily: 'monospace',
          color: count > 0 ? info.color : '#333344',
        }).setOrigin(0.5, 0).setDepth(902);
        this.toolbarElements.push(label);

        // Count
        const countText = this.add.text(sx + slotSize / 2, sy + 37, count > 0 ? String(count) : '', {
          fontSize: '10px', fontFamily: 'monospace', fontStyle: 'bold',
          color: '#ffffff',
        }).setOrigin(0.5, 0).setDepth(902);
        this.toolbarElements.push(countText);
      }

      // Slot number
      const numText = this.add.text(sx + 3, sy + 2, String((i + 1) % 10), {
        fontSize: '8px', fontFamily: 'monospace',
        color: isActive ? '#00ff88' : '#334455',
      }).setDepth(902);
      this.toolbarElements.push(numText);

      this.toolbarElements.push(slotGfx);

      // Drop zone for this slot
      const dropZone = this.add.zone(sx + slotSize / 2, sy + slotSize / 2, slotSize, slotSize)
        .setInteractive({ dropZone: true })
        .setDepth(903);
      dropZone._slotIndex = i;
      this.toolbarElements.push(dropZone);

      // Click to select slot
      dropZone.on('pointerdown', () => {
        if (this.activeToolbarSlot === i) {
          this.activeToolbarSlot = -1;
        } else {
          this.activeToolbarSlot = i;
        }
        this._renderToolbar();
      });
    }
  }

  _repositionHotbar(camW, camH) {
    this._renderToolbar();
  }

  getActiveToolbarItem() {
    if (this.activeToolbarSlot >= 0) {
      return this.toolbarSlots[this.activeToolbarSlot];
    }
    return null;
  }

  selectToolbarSlot(index) {
    if (index >= 0 && index < this.toolbarSlots.length) {
      if (this.activeToolbarSlot === index) {
        this.activeToolbarSlot = -1;
      } else {
        this.activeToolbarSlot = index;
      }
      this._renderToolbar();
    }
  }

  assignToolbarSlot(index, itemKey) {
    if (index >= 0 && index < this.toolbarSlots.length) {
      // Remove from any other slot first
      for (let i = 0; i < this.toolbarSlots.length; i++) {
        if (this.toolbarSlots[i] === itemKey) {
          this.toolbarSlots[i] = null;
        }
      }
      this.toolbarSlots[index] = itemKey;
      this._renderToolbar();
    }
  }

  // ── Drag and Drop ──

  startDragItem(itemKey, pointer) {
    this._dragItem = itemKey;
    const info = ITEM_INFO[itemKey];
    if (!info) return;

    const swatchHex = parseInt(info.color.replace('#', ''), 16);
    this._dragIcon = this.add.graphics().setDepth(5000);
    this._dragIcon.fillStyle(swatchHex, 0.8);
    this._dragIcon.fillRoundedRect(-16, -16, 32, 32, 4);
    this._dragIcon.fillStyle(0xffffff, 0.2);
    this._dragIcon.fillRect(-14, -14, 28, 6);
    this._dragIcon.setPosition(pointer.x, pointer.y);

    this._dragLabel = this.add.text(pointer.x, pointer.y + 20, info.label, {
      fontSize: '9px', fontFamily: 'monospace', color: '#ffffff',
      backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0).setDepth(5001);
  }

  updateDrag(pointer) {
    if (!this._dragIcon) return;
    this._dragIcon.setPosition(pointer.x, pointer.y);
    this._dragLabel.setPosition(pointer.x, pointer.y + 20);
  }

  endDrag(pointer) {
    if (!this._dragItem) return;
    const itemKey = this._dragItem;

    // Check if dropped on a toolbar slot
    const slotSize = this._toolbarSlotSize;
    const pad = this._toolbarPad;
    for (let i = 0; i < this.toolbarSlots.length; i++) {
      const sx = this._toolbarX + 12 + i * (slotSize + pad);
      const sy = this._toolbarY + 6;
      if (pointer.x >= sx && pointer.x <= sx + slotSize &&
          pointer.y >= sy && pointer.y <= sy + slotSize) {
        this.assignToolbarSlot(i, itemKey);
        break;
      }
    }

    // Cleanup
    if (this._dragIcon) { this._dragIcon.destroy(); this._dragIcon = null; }
    if (this._dragLabel) { this._dragLabel.destroy(); this._dragLabel = null; }
    this._dragItem = null;
  }

  isDragging() {
    return this._dragItem !== null;
  }

  // ── Minimap ──

  _createMinimap() {
    const cam = this.cameras.main;
    const size = this.minimapSize;
    const margin = 10;

    // Border/bg
    this.minimapBorder = this.add.graphics().setDepth(800);
    this.minimapOverlay = this.add.graphics().setDepth(802);

    // Canvas for the map tiles
    const canvasKey = 'minimap_canvas';
    if (this.textures.exists(canvasKey)) this.textures.remove(canvasKey);
    this.minimapCanvas = this.textures.createCanvas(canvasKey, size, size);
    const ctx = this.minimapCanvas.context;
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, size, size);
    this.minimapCanvas.refresh();

    this.minimapSprite = this.add.sprite(
      cam.width - margin - size, margin, canvasKey
    ).setOrigin(0, 0).setDepth(801);

    // Label
    this.minimapLabel = this.add.text(
      cam.width - margin - size + 4, margin + 2, 'MAP [M]', {
        fontSize: '9px', fontFamily: 'monospace', color: '#00ff8866',
      }
    ).setDepth(803);

    this._drawMinimapBorder();
  }

  _drawMinimapBorder() {
    const cam = this.cameras.main;
    const size = this.minimapSize;
    const margin = 10;
    const x = cam.width - margin - size;
    const y = margin;

    this.minimapBorder.clear();
    this.minimapBorder.fillStyle(0x080810, 0.85);
    this.minimapBorder.fillRoundedRect(x - 3, y - 3, size + 6, size + 6, 4);
    this.minimapBorder.lineStyle(1, 0x00ff88, 0.3);
    this.minimapBorder.strokeRoundedRect(x - 3, y - 3, size + 6, size + 6, 4);
  }

  _repositionMinimap(camW, camH) {
    if (!this.minimapSprite) return;
    const size = this.minimapSize;
    const margin = 10;
    this.minimapSprite.setPosition(camW - margin - size, margin);
    this.minimapLabel.setPosition(camW - margin - size + 4, margin + 2);
    this._drawMinimapBorder();
  }

  toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
    const vis = this.minimapVisible;
    this.minimapBorder.setVisible(vis);
    this.minimapSprite.setVisible(vis);
    this.minimapOverlay.setVisible(vis);
    this.minimapLabel.setVisible(vis);
  }

  /**
   * Called by GameScene when a chunk is loaded.
   * Renders a 1px-per-tile mini canvas of the actual terrain.
   */
  registerChunk(cx, cy, tiles, size) {
    const key = `${cx},${cy}`;

    // Create a small canvas: 1 pixel per tile
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const d = imgData.data;

    const TILE_RGB = {
      0: [18,32,62], 1: [34,62,102], 2: [194,178,128], 3: [90,65,38],
      4: [42,88,48], 5: [95,95,90], 6: [58,56,54], 7: [139,94,60],
      8: [184,115,51], 9: [42,170,90], 10: [136,204,238], 11: [30,90,45],
      100: [72,72,82], 101: [100,100,110],
      200: [204,136,51], 201: [102,136,204], 202: [136,102,68], 203: [204,68,34],
    };

    for (let i = 0; i < tiles.length; i++) {
      const col = TILE_RGB[tiles[i]] || [30, 30, 30];
      const p = i * 4;
      d[p] = col[0]; d[p+1] = col[1]; d[p+2] = col[2]; d[p+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    this.exploredChunks[key] = { cx, cy, canvas };
    this._redrawMinimap();
  }

  /**
   * Called every frame by GameScene with current player/entity positions.
   */
  updateMinimapEntities(selfX, selfY, chunkSize, otherPlayers, machines) {
    this.playerPositions = [
      { x: selfX, y: selfY, isSelf: true },
      ...otherPlayers,
    ];
    this.machinePositions = machines || [];
    this._drawMinimapOverlay(selfX, selfY, chunkSize);
  }

  _redrawMinimap() {
    // Mark dirty — actual render happens in updateMinimapEntities where we have player position
    this._minimapDirty = true;
  }

  _renderMinimapCentered(selfX, selfY, chunkSize) {
    if (!this.minimapCanvas) return;
    const ctx = this.minimapCanvas.context;
    const size = this.minimapSize;
    const tileSize = 32;
    const chunkPx = chunkSize * tileSize;

    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, size, size);

    const chunks = Object.values(this.exploredChunks);
    if (chunks.length === 0) { this.minimapCanvas.refresh(); return; }

    // Player chunk position (float)
    const playerCX = selfX / chunkPx;
    const playerCY = selfY / chunkPx;

    // Pixels per chunk on minimap
    const scale = 8;

    ctx.imageSmoothingEnabled = false;
    const half = size / 2;

    for (const c of chunks) {
      const px = half + (c.cx - playerCX) * scale;
      const py = half + (c.cy - playerCY) * scale;
      if (px + scale < 0 || px > size || py + scale < 0 || py > size) continue;
      ctx.drawImage(c.canvas, px, py, scale, scale);
    }

    // Player dot at center
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(half - 2, half - 2, 4, 4);

    this.minimapCanvas.refresh();
    this._minimapDirty = false;
  }

  _drawMinimapOverlay(selfX, selfY, chunkSize) {
    if (!this.minimapVisible) return;

    // Render minimap centered on player every frame
    this._renderMinimapCentered(selfX, selfY, chunkSize);

    // Draw other player dots on the overlay
    const ov = this.minimapOverlay;
    ov.clear();

    const cam = this.cameras.main;
    const size = this.minimapSize;
    const margin = 10;
    const mapX = cam.width - margin - size;
    const mapY = margin;
    const scale = 8; // must match _renderMinimapCentered
    const tileSize = 32;
    const chunkPx = chunkSize * tileSize;
    const half = size / 2;
    const playerCX = selfX / chunkPx;
    const playerCY = selfY / chunkPx;

    for (const p of this.playerPositions) {
      if (p.isSelf) continue;
      const pcx = p.x / chunkPx;
      const pcy = p.y / chunkPx;
      const px = mapX + half + (pcx - playerCX) * scale;
      const py = mapY + half + (pcy - playerCY) * scale;
      if (px < mapX || px > mapX + size || py < mapY || py > mapY + size) continue;
      ov.fillStyle(0x4488ff, 1);
      ov.fillRect(px - 1, py - 1, 3, 3);
    }
  }

  updateInventory(inventory) {
    this.inventory = inventory;
    // Refresh toolbar counts
    this._renderToolbar();
    // Refresh inventory panel if open
    if (this.inventoryOpen) {
      this.showInventory();
    }
  }

  updateBuildMode(buildMode) {
    this.buildMode = buildMode;
  }

  updateCoords(text) {
    this.coordText.setText(text);
  }

  updateTileInfo(text) {
    this.tileInfoText.setText(text);
  }

  setStatus(text) {
    this.statusText.setText(text);
  }

  hideStatus() {
    this.statusText.setVisible(false);
  }

  showToast(msg, duration = 2000) {
    this.toastText.setText(msg).setVisible(true);
    if (this._toastTimer) this._toastTimer.remove();
    this._toastTimer = this.time.delayedCall(duration, () => this.toastText.setVisible(false));
  }

  // ── Machine UI ──

  showMachineUI(machine) {
    this.closeMachineUI();
    this.machineUIOpen = true;
    this.machineUIData = machine;

    const cam = this.cameras.main;
    const panelW = 300;
    const panelH = 260;
    const px = cam.width - panelW - 20;
    const py = 20;

    const bg = this.add.graphics().setDepth(2000);
    bg.fillStyle(0x111122, 0.92);
    bg.fillRoundedRect(px, py, panelW, panelH, 8);
    bg.lineStyle(1, 0x4466aa, 0.6);
    bg.strokeRoundedRect(px, py, panelW, panelH, 8);
    this.machineUIElements.push(bg);

    const ts = { fontSize: '12px', fontFamily: 'monospace', color: '#ccccdd' };

    const title = this.add.text(px + 10, py + 8, machine.name, {
      ...ts, fontSize: '15px', color: '#ffcc44',
    }).setDepth(2001);
    this.machineUIElements.push(title);

    let yOff = py + 35;

    // Input
    this.machineUIElements.push(
      this.add.text(px + 10, yOff, 'Input:', { ...ts, color: '#88aacc' }).setDepth(2001)
    );
    yOff += 18;

    const inputs = Object.entries(machine.inventory);
    if (inputs.length === 0) {
      this.machineUIElements.push(
        this.add.text(px + 20, yOff, '(empty)', { ...ts, color: '#555566' }).setDepth(2001)
      );
      yOff += 16;
    } else {
      for (const [item, count] of inputs) {
        this.machineUIElements.push(
          this.add.text(px + 20, yOff, `${item}: ${count}`, ts).setDepth(2001)
        );
        yOff += 16;
      }
    }
    yOff += 6;

    // Output
    this.machineUIElements.push(
      this.add.text(px + 10, yOff, 'Output:', { ...ts, color: '#88ccaa' }).setDepth(2001)
    );
    yOff += 18;

    const outputs = Object.entries(machine.output);
    if (outputs.length === 0) {
      this.machineUIElements.push(
        this.add.text(px + 20, yOff, '(empty)', { ...ts, color: '#555566' }).setDepth(2001)
      );
      yOff += 16;
    } else {
      for (const [item, count] of outputs) {
        this.machineUIElements.push(
          this.add.text(px + 20, yOff, `${item}: ${count}`, { ...ts, color: '#aaffaa' }).setDepth(2001)
        );
        yOff += 16;
      }
    }
    yOff += 6;

    // Recipe
    if (machine.machine_type === 201 || machine.machine_type === 203) {
      this.machineUIElements.push(
        this.add.text(px + 10, yOff, `Recipe: ${machine.recipe || 'none (set with F1-F5)'}`, {
          ...ts, color: '#ccaa88',
        }).setDepth(2001)
      );
      yOff += 18;

      // Show available recipes
      const recipeHints = {
        203: 'F1:iron_plate F2:copper_plate',
        201: 'F3:iron_gear F4:circuit F5:wall_block',
      };
      if (recipeHints[machine.machine_type]) {
        this.machineUIElements.push(
          this.add.text(px + 10, yOff, recipeHints[machine.machine_type], {
            ...ts, fontSize: '10px', color: '#667788',
          }).setDepth(2001)
        );
      }
    }

    // Controls
    yOff = py + panelH - 30;
    this.machineUIElements.push(
      this.add.text(px + 10, yOff,
        '[R] Collect  [7-0] Deposit  [Q] Close', {
          ...ts, fontSize: '10px', color: '#667788',
        }).setDepth(2001)
    );
  }

  closeMachineUI() {
    this.machineUIOpen = false;
    this.machineUIData = null;
    for (const el of this.machineUIElements) el.destroy();
    this.machineUIElements = [];
  }

  // ── Inventory Panel ──

  toggleInventory() {
    if (this.inventoryOpen) {
      this.closeInventory();
    } else {
      this.showInventory();
    }
  }

  showInventory() {
    this.closeInventory();
    this.inventoryOpen = true;

    const cam = this.cameras.main;

    // Only show items the player actually has
    const ownedItems = Object.entries(ITEM_INFO).filter(([key, info]) => !info.buildable && (this.inventory[key] || 0) > 0);
    const buildableItems = Object.entries(ITEM_INFO).filter(([key, info]) => info.buildable);
    const cols = 6;
    const cellSize = 68;
    const cellPad = 5;
    const titleBarH = 32;
    const pad = 12;
    const sectionLabelH = 22;
    const minSlots = Math.max(ownedItems.length, 6);
    const invRows = Math.ceil(minSlots / cols);
    const buildRows = Math.ceil(buildableItems.length / cols);
    const gridW = cols * (cellSize + cellPad) - cellPad;
    const panelW = gridW + pad * 2;
    const panelH = titleBarH + pad
      + invRows * (cellSize + cellPad) - cellPad
      + sectionLabelH + pad
      + buildRows * (cellSize + cellPad) - cellPad
      + pad;

    const startX = this._invPosX ?? (cam.width - panelW) / 2;
    const startY = this._invPosY ?? (cam.height - panelH) / 2;

    // Store panel dimensions for hit testing
    this._invPanelW = panelW;
    this._invPanelH = panelH;

    const container = this.add.container(startX, startY).setDepth(3000);
    this.inventoryContainer = container;
    this.inventoryElements.push(container);

    // Panel background
    const bg = this.add.graphics();
    bg.fillStyle(0x0d1117, 0.95);
    bg.fillRoundedRect(0, 0, panelW, panelH, 8);
    bg.lineStyle(1, 0x00ff88, 0.35);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 8);
    container.add(bg);

    // Title bar
    const titleBar = this.add.graphics();
    titleBar.fillStyle(0x141e2a, 1);
    titleBar.fillRoundedRect(0, 0, panelW, titleBarH, { tl: 8, tr: 8, bl: 0, br: 0 });
    titleBar.lineStyle(1, 0x00ff88, 0.2);
    titleBar.lineBetween(0, titleBarH, panelW, titleBarH);
    container.add(titleBar);

    container.add(this.add.text(pad, 8, 'INVENTORY', {
      fontSize: '14px', fontFamily: 'monospace', color: '#00ff88', fontStyle: 'bold',
    }));

    container.add(this.add.text(panelW - pad, 8, '[I] close', {
      fontSize: '10px', fontFamily: 'monospace', color: '#445555',
    }).setOrigin(1, 0));

    // Drag handle
    let dragging = false;
    let dragOffX = 0;
    let dragOffY = 0;

    const dragHit = this.add.rectangle(
      startX + panelW / 2, startY + titleBarH / 2,
      panelW, titleBarH, 0x000000, 0
    ).setInteractive({ useHandCursor: true }).setDepth(3003);
    this.inventoryElements.push(dragHit);

    dragHit.on('pointerdown', (pointer) => {
      dragging = true;
      dragOffX = pointer.x - container.x;
      dragOffY = pointer.y - container.y;
    });

    const onMove = (pointer) => {
      if (!dragging) return;
      container.x = pointer.x - dragOffX;
      container.y = pointer.y - dragOffY;
      dragHit.x = container.x + panelW / 2;
      dragHit.y = container.y + titleBarH / 2;
      this._invPosX = container.x;
      this._invPosY = container.y;
    };
    const onUp = () => { dragging = false; };

    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this._invDragCleanup = () => {
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
    };

    // Grid cells — only owned items + empty filler slots
    for (let i = 0; i < minSlots; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = pad + col * (cellSize + cellPad);
      const cy = titleBarH + pad + row * (cellSize + cellPad);

      const itemEntry = ownedItems[i];
      const cell = this.add.graphics();

      if (itemEntry) {
        const [key, info] = itemEntry;
        const count = this.inventory[key] || 0;
        const swatchHex = parseInt(info.color.replace('#', ''), 16);

        // Cell bg
        cell.fillStyle(0x1a2233, 1);
        cell.fillRoundedRect(cx, cy, cellSize, cellSize, 5);
        cell.lineStyle(1, swatchHex, 0.5);
        cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 5);

        // Icon
        const iconSize = 26;
        const iconX = cx + (cellSize - iconSize) / 2;
        const iconY = cy + 5;
        cell.fillStyle(swatchHex, 1);
        cell.fillRoundedRect(iconX, iconY, iconSize, iconSize, 4);
        cell.fillStyle(0xffffff, 0.18);
        cell.fillRect(iconX + 2, iconY + 2, iconSize - 4, 6);

        container.add(cell);

        // Label
        container.add(this.add.text(cx + cellSize / 2, cy + 35, info.label, {
          fontSize: '9px', fontFamily: 'monospace', color: info.color,
        }).setOrigin(0.5, 0));

        // Count
        container.add(this.add.text(cx + cellSize / 2, cy + 49, String(count), {
          fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
        }).setOrigin(0.5, 0));

        // Drag handle — separate interactive zone at screen position
        const dragHandle = this.add.rectangle(
          startX + cx + cellSize / 2, startY + cy + cellSize / 2,
          cellSize, cellSize, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(3005);
        this.inventoryElements.push(dragHandle);

        const capturedKey = key;
        let isDragging = false;

        dragHandle.on('pointerdown', (pointer) => {
          isDragging = false;
          this._invDragStartX = pointer.x;
          this._invDragStartY = pointer.y;
          this._invDragKey = capturedKey;
        });

        dragHandle.on('pointermove', (pointer) => {
          if (!this._invDragKey || this._invDragKey !== capturedKey) return;
          if (!isDragging) {
            const dist = Math.abs(pointer.x - this._invDragStartX) + Math.abs(pointer.y - this._invDragStartY);
            if (dist > 8) {
              isDragging = true;
              this.startDragItem(capturedKey, pointer);
            }
          }
        });
      } else {
        // Empty slot
        cell.fillStyle(0x0a0a10, 0.5);
        cell.fillRoundedRect(cx, cy, cellSize, cellSize, 5);
        cell.lineStyle(1, 0x151520, 0.3);
        cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 5);
        container.add(cell);
      }
    }

    // Empty inventory message
    if (ownedItems.length === 0) {
      container.add(this.add.text(panelW / 2, titleBarH + pad + 20, 'Empty — mine some resources!', {
        fontSize: '12px', fontFamily: 'monospace', color: '#334444',
      }).setOrigin(0.5, 0));
    }

    // ── Buildables section ──
    const buildSectionY = titleBarH + pad + invRows * (cellSize + cellPad);

    // Section label
    const buildLabel = this.add.graphics();
    buildLabel.fillStyle(0x1a1510, 0.8);
    buildLabel.fillRoundedRect(pad, buildSectionY, panelW - pad * 2, sectionLabelH, 3);
    container.add(buildLabel);
    container.add(this.add.text(pad + 8, buildSectionY + 4, 'BUILDABLES — drag to toolbar', {
      fontSize: '10px', fontFamily: 'monospace', color: '#cc8833',
    }));

    const buildGridY = buildSectionY + sectionLabelH + pad;

    for (let i = 0; i < buildableItems.length; i++) {
      const [key, info] = buildableItems[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = pad + col * (cellSize + cellPad);
      const cy = buildGridY + row * (cellSize + cellPad);
      const swatchHex = parseInt(info.color.replace('#', ''), 16);

      const cell = this.add.graphics();
      cell.fillStyle(0x1a1510, 1);
      cell.fillRoundedRect(cx, cy, cellSize, cellSize, 5);
      cell.lineStyle(1, swatchHex, 0.5);
      cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 5);

      const iconSize = 26;
      const iconX = cx + (cellSize - iconSize) / 2;
      const iconY = cy + 5;
      cell.fillStyle(swatchHex, 1);
      cell.fillRoundedRect(iconX, iconY, iconSize, iconSize, 4);
      cell.fillStyle(0xffffff, 0.18);
      cell.fillRect(iconX + 2, iconY + 2, iconSize - 4, 6);
      container.add(cell);

      container.add(this.add.text(cx + cellSize / 2, cy + 35, info.label, {
        fontSize: '9px', fontFamily: 'monospace', color: info.color,
      }).setOrigin(0.5, 0));

      // Drag handle for buildable
      const dragHandle = this.add.rectangle(
        startX + cx + cellSize / 2, startY + cy + cellSize / 2,
        cellSize, cellSize, 0x000000, 0
      ).setInteractive({ useHandCursor: true }).setDepth(3005);
      this.inventoryElements.push(dragHandle);

      const capturedKey = key;
      dragHandle.on('pointerdown', (pointer) => {
        this._invDragStartX = pointer.x;
        this._invDragStartY = pointer.y;
        this._invDragKey = capturedKey;
      });
      dragHandle.on('pointermove', (pointer) => {
        if (!this._invDragKey || this._invDragKey !== capturedKey) return;
        const dist = Math.abs(pointer.x - this._invDragStartX) + Math.abs(pointer.y - this._invDragStartY);
        if (dist > 8) {
          this.startDragItem(capturedKey, pointer);
        }
      });
    }
  }

  /**
   * Check if a screen-space point is inside the inventory panel.
   */
  isPointInInventory(screenX, screenY) {
    if (!this.inventoryOpen || !this.inventoryContainer) return false;
    const c = this.inventoryContainer;
    return (
      screenX >= c.x && screenX <= c.x + (this._invPanelW || 0) &&
      screenY >= c.y && screenY <= c.y + (this._invPanelH || 0)
    );
  }

  closeInventory() {
    this.inventoryOpen = false;
    if (this._invDragCleanup) {
      this._invDragCleanup();
      this._invDragCleanup = null;
    }
    for (const el of this.inventoryElements) el.destroy();
    this.inventoryElements = [];
    this.inventoryContainer = null;
  }

  // ── Crafting Menu ──

  toggleCrafting() {
    if (this.craftingOpen) {
      this.closeCrafting();
    } else {
      this.showCrafting();
    }
  }

  showCrafting() {
    this.closeCrafting();
    this.craftingOpen = true;

    const cam = this.cameras.main;
    const ts = { fontSize: '12px', fontFamily: 'monospace', color: '#ccccdd' };
    const tsSmall = { fontSize: '10px', fontFamily: 'monospace', color: '#889999' };

    // Build all craftable entries
    const sections = [
      {
        title: 'STRUCTURES',
        color: '#7788aa',
        items: [
          { name: 'Wall', key: '1', cost: { stone: 3 } },
          { name: 'Floor', key: '2', cost: { stone: 1 } },
        ],
      },
      {
        title: 'MACHINES',
        color: '#cc8833',
        items: [
          { name: 'Auto-Miner', key: '3', cost: { stone: 5, iron_ore: 3 } },
          { name: 'Furnace', key: '4', cost: { stone: 10 } },
          { name: 'Fabricator', key: '5', cost: { stone: 8, iron_plate: 4 } },
          { name: 'Storage Crate', key: '6', cost: { stone: 4 } },
        ],
      },
      {
        title: 'SMELTING (Furnace)',
        color: '#cc4422',
        items: [
          { name: 'Iron Plate', key: 'F1', cost: { iron_ore: 2 }, machine: true },
          { name: 'Copper Plate', key: 'F2', cost: { copper_ore: 2 }, machine: true },
        ],
      },
      {
        title: 'CRAFTING (Fabricator)',
        color: '#6688cc',
        items: [
          { name: 'Iron Gear', key: 'F3', cost: { iron_plate: 2 }, machine: true },
          { name: 'Circuit', key: 'F4', cost: { copper_plate: 1, iron_plate: 1 }, machine: true },
          { name: 'Wall Block', key: 'F5', cost: { stone: 5 }, machine: true },
        ],
      },
    ];

    // Calculate panel size
    const panelW = 320;
    const titleBarH = 32;
    const pad = 14;
    const sectionGap = 8;
    const sectionHeaderH = 22;
    const rowH = 38;

    let totalContentH = pad;
    for (const section of sections) {
      totalContentH += sectionHeaderH + sectionGap;
      totalContentH += section.items.length * rowH;
      totalContentH += sectionGap;
    }
    const panelH = titleBarH + totalContentH + pad;

    const startX = this._craftPosX ?? (cam.width - panelW) / 2;
    const startY = this._craftPosY ?? (cam.height - panelH) / 2;

    this._craftPanelW = panelW;
    this._craftPanelH = panelH;

    const container = this.add.container(startX, startY).setDepth(3100);
    this.craftingContainer = container;
    this.craftingElements.push(container);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x0d1117, 0.95);
    bg.fillRoundedRect(0, 0, panelW, panelH, 8);
    bg.lineStyle(1, 0xffcc44, 0.35);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 8);
    container.add(bg);

    // Title bar
    const titleBar = this.add.graphics();
    titleBar.fillStyle(0x1a1a10, 1);
    titleBar.fillRoundedRect(0, 0, panelW, titleBarH, { tl: 8, tr: 8, bl: 0, br: 0 });
    titleBar.lineStyle(1, 0xffcc44, 0.2);
    titleBar.lineBetween(0, titleBarH, panelW, titleBarH);
    container.add(titleBar);

    container.add(this.add.text(pad, 8, 'CRAFTING', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffcc44', fontStyle: 'bold',
    }));
    container.add(this.add.text(panelW - pad, 8, '[C] close', {
      fontSize: '10px', fontFamily: 'monospace', color: '#554433',
    }).setOrigin(1, 0));

    // Drag handle
    let dragging = false;
    let dragOffX = 0;
    let dragOffY = 0;

    const dragHit = this.add.rectangle(
      startX + panelW / 2, startY + titleBarH / 2,
      panelW, titleBarH, 0x000000, 0
    ).setInteractive({ useHandCursor: true }).setDepth(3103);
    this.craftingElements.push(dragHit);

    dragHit.on('pointerdown', (pointer) => {
      dragging = true;
      dragOffX = pointer.x - container.x;
      dragOffY = pointer.y - container.y;
    });

    const onMove = (pointer) => {
      if (!dragging) return;
      container.x = pointer.x - dragOffX;
      container.y = pointer.y - dragOffY;
      dragHit.x = container.x + panelW / 2;
      dragHit.y = container.y + titleBarH / 2;
      this._craftPosX = container.x;
      this._craftPosY = container.y;
    };
    const onUp = () => { dragging = false; };
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this._craftDragCleanup = () => {
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
    };

    // Render sections
    let yOff = titleBarH + pad;

    for (const section of sections) {
      // Section header
      const headerBg = this.add.graphics();
      headerBg.fillStyle(0x151520, 0.8);
      headerBg.fillRoundedRect(pad - 2, yOff, panelW - pad * 2 + 4, sectionHeaderH, 3);
      container.add(headerBg);

      container.add(this.add.text(pad + 6, yOff + 4, section.title, {
        fontSize: '11px', fontFamily: 'monospace', color: section.color, fontStyle: 'bold',
      }));
      yOff += sectionHeaderH + sectionGap;

      // Items
      for (const item of section.items) {
        const costStr = Object.entries(item.cost)
          .map(([k, v]) => {
            const have = this.inventory[k] || 0;
            const label = (ITEM_INFO[k]?.label || k).slice(0, 8);
            const canAfford = have >= v;
            return `${label}:${have}/${v}`;
          })
          .join('  ');

        const canCraft = Object.entries(item.cost).every(
          ([k, v]) => (this.inventory[k] || 0) >= v
        );

        // Row bg
        const rowBg = this.add.graphics();
        rowBg.fillStyle(canCraft ? 0x1a2a1a : 0x111115, 0.6);
        rowBg.fillRoundedRect(pad, yOff, panelW - pad * 2, rowH - 4, 3);
        if (canCraft) {
          rowBg.lineStyle(1, 0x33aa44, 0.2);
          rowBg.strokeRoundedRect(pad, yOff, panelW - pad * 2, rowH - 4, 3);
        }
        container.add(rowBg);

        // Key badge
        const badgeBg = this.add.graphics();
        const badgeW = item.key.length > 1 ? 28 : 20;
        badgeBg.fillStyle(canCraft ? 0x33aa44 : 0x333344, canCraft ? 0.8 : 0.4);
        badgeBg.fillRoundedRect(pad + 6, yOff + 4, badgeW, 16, 3);
        container.add(badgeBg);

        container.add(this.add.text(pad + 6 + badgeW / 2, yOff + 5, item.key, {
          fontSize: '10px', fontFamily: 'monospace',
          color: canCraft ? '#ffffff' : '#666677', fontStyle: 'bold',
        }).setOrigin(0.5, 0));

        // Item name
        container.add(this.add.text(pad + 8 + badgeW + 6, yOff + 4, item.name, {
          fontSize: '12px', fontFamily: 'monospace',
          color: canCraft ? '#ddddee' : '#556666',
        }));

        // Machine indicator
        if (item.machine) {
          container.add(this.add.text(panelW - pad - 6, yOff + 4, 'recipe', {
            fontSize: '9px', fontFamily: 'monospace', color: '#445555',
          }).setOrigin(1, 0));
        }

        // Cost line
        container.add(this.add.text(pad + 8 + badgeW + 6, yOff + 19, costStr, {
          fontSize: '9px', fontFamily: 'monospace',
          color: canCraft ? '#66aa77' : '#443333',
        }));

        yOff += rowH;
      }
      yOff += sectionGap;
    }
  }

  isPointInCrafting(screenX, screenY) {
    if (!this.craftingOpen || !this.craftingContainer) return false;
    const c = this.craftingContainer;
    return (
      screenX >= c.x && screenX <= c.x + (this._craftPanelW || 0) &&
      screenY >= c.y && screenY <= c.y + (this._craftPanelH || 0)
    );
  }

  isPointInToolbar(screenX, screenY) {
    if (!this._toolbarX) return false;
    return (
      screenX >= this._toolbarX && screenX <= this._toolbarX + this._toolbarW &&
      screenY >= this._toolbarY && screenY <= this._toolbarY + this._toolbarH
    );
  }

  closeCrafting() {
    this.craftingOpen = false;
    if (this._craftDragCleanup) {
      this._craftDragCleanup();
      this._craftDragCleanup = null;
    }
    for (const el of this.craftingElements) el.destroy();
    this.craftingElements = [];
    this.craftingContainer = null;
  }

  // ── World Map (full screen) ──

  toggleWorldMap() {
    if (this.worldMapOpen) {
      this.closeWorldMap();
    } else {
      this.showWorldMap();
    }
  }

  showWorldMap() {
    this.closeWorldMap();
    this.worldMapOpen = true;

    const cam = this.cameras.main;
    const margin = 30;
    const mapW = cam.width - margin * 2;
    const mapH = cam.height - margin * 2;
    const chunkWorldPx = 64 * 32;

    // State for pan/zoom
    this._wmPanX = 0;
    this._wmPanY = 0;
    this._wmZoom = 16; // pixels per chunk
    this._wmMapW = mapW;
    this._wmMapH = mapH;
    this._wmMargin = margin;

    // Center on player
    const chunks = Object.values(this.exploredChunks);
    if (this.playerPositions.length > 0) {
      const self = this.playerPositions.find(p => p.isSelf) || this.playerPositions[0];
      this._wmPanX = -(self.x / chunkWorldPx) * this._wmZoom + mapW / 2;
      this._wmPanY = -(self.y / chunkWorldPx) * this._wmZoom + mapH / 2;
    }

    // Dark overlay
    const overlay = this.add.graphics().setDepth(4000);
    overlay.fillStyle(0x000000, 0.85);
    overlay.fillRect(0, 0, cam.width, cam.height);
    this.worldMapElements.push(overlay);

    // Map border
    const border = this.add.graphics().setDepth(4001);
    border.fillStyle(0x080c12, 0.98);
    border.fillRoundedRect(margin, margin, mapW, mapH, 8);
    border.lineStyle(1, 0x00ff88, 0.3);
    border.strokeRoundedRect(margin, margin, mapW, mapH, 8);
    this.worldMapElements.push(border);

    // Map content canvas (redrawn on pan/zoom)
    const wmCanvasKey = 'worldmap_canvas';
    if (this.textures.exists(wmCanvasKey)) this.textures.remove(wmCanvasKey);
    this._wmCanvasTex = this.textures.createCanvas(wmCanvasKey, mapW, mapH);
    this._wmSprite = this.add.sprite(margin, margin, wmCanvasKey).setOrigin(0, 0).setDepth(4002);
    this.worldMapElements.push(this._wmSprite);

    // Dots overlay (Phaser graphics for player markers)
    this._wmDots = this.add.graphics().setDepth(4003);
    this.worldMapElements.push(this._wmDots);

    // HUD elements on top
    this.worldMapElements.push(
      this.add.text(cam.width / 2, margin + 10, 'WORLD MAP', {
        fontSize: '16px', fontFamily: 'monospace', color: '#00ff88', fontStyle: 'bold',
        backgroundColor: '#080c12ee', padding: { x: 10, y: 4 },
      }).setOrigin(0.5, 0).setDepth(4004)
    );

    this._wmInfoText = this.add.text(cam.width / 2, margin + 32,
      'WASD/Arrows: pan | Scroll: zoom | M/ESC: close', {
        fontSize: '10px', fontFamily: 'monospace', color: '#445555',
        backgroundColor: '#080c12cc', padding: { x: 8, y: 2 },
      }).setOrigin(0.5, 0).setDepth(4004);
    this.worldMapElements.push(this._wmInfoText);

    // Legend bar at bottom
    const legY = margin + mapH - 24;
    const legBg = this.add.graphics().setDepth(4004);
    legBg.fillStyle(0x080c12, 0.9);
    legBg.fillRect(margin, legY - 4, mapW, 24);
    this.worldMapElements.push(legBg);

    const legDots = this.add.graphics().setDepth(4005);
    legDots.fillStyle(0x00ff88, 1); legDots.fillCircle(margin + 20, legY + 7, 4);
    legDots.fillStyle(0x4488ff, 1); legDots.fillCircle(margin + 80, legY + 7, 3);
    this.worldMapElements.push(legDots);
    this.worldMapElements.push(
      this.add.text(margin + 28, legY, 'You', { fontSize: '10px', fontFamily: 'monospace', color: '#00ff88' }).setDepth(4005)
    );
    this.worldMapElements.push(
      this.add.text(margin + 88, legY, 'Players', { fontSize: '10px', fontFamily: 'monospace', color: '#4488ff' }).setDepth(4005)
    );

    this._wmChunkCount = this.add.text(margin + mapW - 10, legY,
      `${chunks.length} chunks`, {
        fontSize: '10px', fontFamily: 'monospace', color: '#445555',
      }).setOrigin(1, 0).setDepth(4005);
    this.worldMapElements.push(this._wmChunkCount);

    // Mouse drag to pan
    let dragging = false;
    let lastX = 0, lastY = 0;

    const hitZone = this.add.rectangle(
      margin + mapW / 2, margin + mapH / 2, mapW, mapH, 0x000000, 0
    ).setInteractive().setDepth(4001);
    this.worldMapElements.push(hitZone);

    hitZone.on('pointerdown', (p) => { dragging = true; lastX = p.x; lastY = p.y; });
    const onMove = (p) => {
      if (!dragging) return;
      this._wmPanX += p.x - lastX;
      this._wmPanY += p.y - lastY;
      lastX = p.x; lastY = p.y;
      this._renderWorldMapContent();
    };
    const onUp = () => { dragging = false; };
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);

    // Scroll to zoom
    const onWheel = (pointer, gameObjects, dx, dy) => {
      const oldZoom = this._wmZoom;
      this._wmZoom = Phaser.Math.Clamp(this._wmZoom - dy * 0.02, 4, 80);
      // Zoom toward center
      const ratio = this._wmZoom / oldZoom;
      const cx = mapW / 2;
      const cy = mapH / 2;
      this._wmPanX = cx - (cx - this._wmPanX) * ratio;
      this._wmPanY = cy - (cy - this._wmPanY) * ratio;
      this._renderWorldMapContent();
    };
    this.input.on('wheel', onWheel);

    this._wmDragCleanup = () => {
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
      this.input.off('wheel', onWheel);
    };

    // Keyboard pan (handled in update)
    this._wmKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
    });

    this._renderWorldMapContent();
  }

  _renderWorldMapContent() {
    if (!this._wmCanvasTex) return;
    const ctx = this._wmCanvasTex.context;
    const dots = this._wmDots;
    dots.clear();

    const margin = this._wmMargin;
    const zoom = this._wmZoom;
    const panX = this._wmPanX;
    const panY = this._wmPanY;
    const mapW = this._wmMapW;
    const mapH = this._wmMapH;
    const chunkWorldPx = 64 * 32;
    const chunkTiles = 64;

    // Clear canvas
    ctx.fillStyle = '#080c12';
    ctx.fillRect(0, 0, mapW, mapH);
    ctx.imageSmoothingEnabled = false;

    const chunks = Object.values(this.exploredChunks);

    // Draw chunk canvases — each chunk.canvas is 64x64 (1px per tile)
    // zoom = pixels per chunk on screen
    for (const c of chunks) {
      const px = panX + c.cx * zoom;
      const py = panY + c.cy * zoom;

      // Cull off-screen
      if (px + zoom < 0 || px > mapW || py + zoom < 0 || py > mapH) continue;

      ctx.drawImage(c.canvas, px, py, zoom, zoom);
    }

    // Grid lines at high zoom
    if (zoom >= 30) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const startCX = Math.floor(-panX / zoom) - 1;
      const endCX = Math.ceil((mapW - panX) / zoom) + 1;
      const startCY = Math.floor(-panY / zoom) - 1;
      const endCY = Math.ceil((mapH - panY) / zoom) + 1;
      ctx.beginPath();
      for (let cx = startCX; cx <= endCX; cx++) {
        const x = panX + cx * zoom;
        if (x >= 0 && x <= mapW) { ctx.moveTo(x, 0); ctx.lineTo(x, mapH); }
      }
      for (let cy = startCY; cy <= endCY; cy++) {
        const y = panY + cy * zoom;
        if (y >= 0 && y <= mapH) { ctx.moveTo(0, y); ctx.lineTo(mapW, y); }
      }
      ctx.stroke();
    }

    this._wmCanvasTex.refresh();

    // Player dots (using Phaser graphics for crisp rendering on top)
    for (const p of this.playerPositions) {
      const pcx = p.x / chunkWorldPx;
      const pcy = p.y / chunkWorldPx;
      const px = margin + panX + pcx * zoom;
      const py = margin + panY + pcy * zoom;

      if (px < margin || px > margin + mapW || py < margin || py > margin + mapH) continue;

      if (p.isSelf) {
        const r = Math.max(4, zoom * 0.2);
        dots.fillStyle(0x00ff88, 1);
        dots.fillCircle(px, py, r);
        dots.lineStyle(2, 0x00ff88, 0.4);
        dots.strokeCircle(px, py, r + 3);
      } else {
        dots.fillStyle(0x4488ff, 1);
        dots.fillCircle(px, py, Math.max(3, zoom * 0.12));
      }
    }
  }

  updateWorldMap() {
    // Called from GameScene update loop for keyboard panning
    if (!this.worldMapOpen || !this._wmKeys) return;
    const speed = 5;
    if (this._wmKeys.left.isDown || this._wmKeys.a.isDown) this._wmPanX += speed;
    if (this._wmKeys.right.isDown || this._wmKeys.d.isDown) this._wmPanX -= speed;
    if (this._wmKeys.up.isDown || this._wmKeys.w.isDown) this._wmPanY += speed;
    if (this._wmKeys.down.isDown || this._wmKeys.s.isDown) this._wmPanY -= speed;

    if (this._wmKeys.left.isDown || this._wmKeys.right.isDown ||
        this._wmKeys.up.isDown || this._wmKeys.down.isDown ||
        this._wmKeys.a.isDown || this._wmKeys.d.isDown ||
        this._wmKeys.w.isDown || this._wmKeys.s.isDown) {
      this._renderWorldMapContent();
    }
  }

  closeWorldMap() {
    this.worldMapOpen = false;
    if (this._wmDragCleanup) {
      this._wmDragCleanup();
      this._wmDragCleanup = null;
    }
    this._wmKeys = null;
    this._wmContent = null;
    this._wmDots = null;
    for (const el of this.worldMapElements) el.destroy();
    this.worldMapElements = [];
  }

  // ── Research Panel ──

  toggleResearch() {
    if (this.researchOpen) {
      this.closeResearch();
    } else {
      this.showResearch();
    }
  }

  updateResearch(state) {
    this.researchState = state;
    if (this.researchOpen) this.showResearch(); // refresh
  }

  showResearch() {
    this.closeResearch();
    this.researchOpen = true;

    const cam = this.cameras.main;
    const tree = this.researchTree;
    const state = this.researchState;
    const completed = new Set(state.completed || []);

    // Grid layout
    const cardSize = 200;
    const gapX = 40;
    const gapY = 22;
    const pad = 24;
    const titleBarH = 44;

    // Find grid bounds from row/col
    let maxCol = 0, maxRow = 0;
    for (const node of Object.values(tree)) {
      if (node.col > maxCol) maxCol = node.col;
      if (node.row > maxRow) maxRow = node.row;
    }

    const cols = maxCol + 1;
    const rows = maxRow + 1;
    const panelW = pad * 2 + cols * cardSize + (cols - 1) * gapX;
    const panelH = titleBarH + pad + rows * cardSize + (rows - 1) * gapY + pad;

    const startX = this._resPosX ?? (cam.width - panelW) / 2;
    const startY = this._resPosY ?? Math.max(20, (cam.height - panelH) / 2);

    this._resPanelW = panelW;
    this._resPanelH = panelH;

    const container = this.add.container(startX, startY).setDepth(3200);
    this.researchContainer = container;
    this.researchElements.push(container);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x0a0e14, 0.96);
    bg.fillRoundedRect(0, 0, panelW, panelH, 8);
    bg.lineStyle(1, 0x8866ff, 0.3);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 8);
    container.add(bg);

    // Title bar
    const titleBar = this.add.graphics();
    titleBar.fillStyle(0x14121e, 1);
    titleBar.fillRoundedRect(0, 0, panelW, titleBarH, { tl: 8, tr: 8, bl: 0, br: 0 });
    titleBar.lineStyle(1, 0x8866ff, 0.15);
    titleBar.lineBetween(0, titleBarH, panelW, titleBarH);
    container.add(titleBar);

    container.add(this.add.text(pad, 12, 'RESEARCH TREE', {
      fontSize: '18px', fontFamily: 'monospace', color: '#8866ff', fontStyle: 'bold',
    }));
    container.add(this.add.text(panelW - pad, 14, '[R] close', {
      fontSize: '13px', fontFamily: 'monospace', color: '#443366',
    }).setOrigin(1, 0));

    // Tier column labels
    const tierLabels = ['I', 'II', 'III', 'IV', 'V'];
    const tierColors = [0x44aa66, 0xaa8844, 0xaa44aa, 0xcc4444, 0x4488cc];
    for (let c = 0; c <= maxCol; c++) {
      const cx = pad + c * (cardSize + gapX) + cardSize / 2;
      container.add(this.add.text(cx, titleBarH + 6, `Tier ${tierLabels[c] || c+1}`, {
        fontSize: '13px', fontFamily: 'monospace',
        color: `#${tierColors[c]?.toString(16).padStart(6, '0') || '888888'}`,
      }).setOrigin(0.5, 0));
    }

    // Drag handle
    let dragging = false, dragOffX = 0, dragOffY = 0;
    const dragHit = this.add.rectangle(
      startX + panelW / 2, startY + titleBarH / 2,
      panelW, titleBarH, 0x000000, 0
    ).setInteractive({ useHandCursor: true }).setDepth(3203);
    this.researchElements.push(dragHit);

    dragHit.on('pointerdown', (p) => { dragging = true; dragOffX = p.x - container.x; dragOffY = p.y - container.y; });
    const onMove = (p) => {
      if (!dragging) return;
      container.x = p.x - dragOffX; container.y = p.y - dragOffY;
      dragHit.x = container.x + panelW / 2; dragHit.y = container.y + titleBarH / 2;
      this._resPosX = container.x; this._resPosY = container.y;
    };
    const onUp = () => { dragging = false; };
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this._resDragCleanup = () => { this.input.off('pointermove', onMove); this.input.off('pointerup', onUp); };

    // Build node positions map for drawing connector lines
    const nodePositions = {};
    for (const [id, node] of Object.entries(tree)) {
      const cx = pad + node.col * (cardSize + gapX) + cardSize / 2;
      const cy = titleBarH + pad + 10 + node.row * (cardSize + gapY) + cardSize / 2;
      nodePositions[id] = { cx, cy };
    }

    // Draw connector lines first (behind cards)
    const lines = this.add.graphics();
    lines.lineStyle(2, 0x333355, 0.5);
    for (const [id, node] of Object.entries(tree)) {
      const to = nodePositions[id];
      for (const prereqId of node.prereqs) {
        const from = nodePositions[prereqId];
        if (from && to) {
          const isPrereqDone = completed.has(prereqId);
          lines.lineStyle(2, isPrereqDone ? 0x44aa66 : 0x222244, isPrereqDone ? 0.6 : 0.3);
          // Horizontal then vertical connector
          const midX = from.cx + cardSize / 2 + gapX / 2;
          lines.beginPath();
          lines.moveTo(from.cx + cardSize / 2, from.cy);
          lines.lineTo(midX, from.cy);
          lines.lineTo(midX, to.cy);
          lines.lineTo(to.cx - cardSize / 2, to.cy);
          lines.strokePath();
        }
      }
    }
    container.add(lines);

    // Draw cards
    for (const [id, node] of Object.entries(tree)) {
      const isCompleted = completed.has(id);
      const isActive = state.active === id;
      const prereqsMet = node.prereqs.every(p => completed.has(p));
      const canAfford = Object.entries(node.cost).every(([k, v]) => (this.inventory[k] || 0) >= v);
      const canStart = !isCompleted && !state.active && prereqsMet && canAfford;
      const isLocked = !prereqsMet && !isCompleted;

      const cx = pad + node.col * (cardSize + gapX);
      const cy = titleBarH + pad + 10 + node.row * (cardSize + gapY);
      const tierColor = tierColors[node.col] || 0x888888;

      // Card background
      const card = this.add.graphics();
      if (isCompleted) {
        card.fillStyle(0x1a2a1a, 1);
        card.lineStyle(2, 0x33aa44, 0.7);
      } else if (isActive) {
        card.fillStyle(0x1a1a2e, 1);
        card.lineStyle(2, 0x8866ff, 0.8);
      } else if (isLocked) {
        card.fillStyle(0x0c0c10, 0.8);
        card.lineStyle(1, 0x1a1a22, 0.4);
      } else if (canStart) {
        card.fillStyle(0x151a20, 1);
        card.lineStyle(2, 0xaaaa44, 0.6);
      } else {
        card.fillStyle(0x12151c, 1);
        card.lineStyle(1, 0x2a2a3a, 0.5);
      }
      card.fillRoundedRect(cx, cy, cardSize, cardSize, 6);
      card.strokeRoundedRect(cx, cy, cardSize, cardSize, 6);

      // Tier color accent bar at top
      card.fillStyle(tierColor, isLocked ? 0.2 : 0.6);
      card.fillRect(cx + 5, cy + 5, cardSize - 10, 5);

      container.add(card);

      // Name
      container.add(this.add.text(cx + cardSize / 2, cy + 18, node.name, {
        fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold',
        color: isLocked ? '#333344' : (isCompleted ? '#55cc66' : '#ccccdd'),
      }).setOrigin(0.5, 0));

      // Description
      container.add(this.add.text(cx + cardSize / 2, cy + 40, node.desc, {
        fontSize: '12px', fontFamily: 'monospace',
        color: isLocked ? '#222233' : '#778899',
        wordWrap: { width: cardSize - 20 },
        align: 'center',
      }).setOrigin(0.5, 0));

      // Cost
      const costLines = Object.entries(node.cost).map(([k, v]) => {
        const have = this.inventory[k] || 0;
        return `${k}: ${have}/${v}`;
      }).join('\n');
      container.add(this.add.text(cx + cardSize / 2, cy + 80, costLines, {
        fontSize: '12px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : (canAfford ? '#66aa77' : '#884444'),
        align: 'center', lineSpacing: 3,
      }).setOrigin(0.5, 0));

      // Time
      container.add(this.add.text(cx + cardSize / 2, cy + 145, `Time: ${node.time}s`, {
        fontSize: '12px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : '#556666',
      }).setOrigin(0.5, 0));

      // Status / Progress
      if (isCompleted) {
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 30, 'DONE', {
          fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold', color: '#33aa44',
        }).setOrigin(0.5, 0));
      } else if (isActive) {
        const pct = state.progress / node.time;
        const bar = this.add.graphics();
        bar.fillStyle(0x222233, 1);
        bar.fillRoundedRect(cx + 10, cy + cardSize - 32, cardSize - 20, 18, 4);
        bar.fillStyle(0x8866ff, 1);
        bar.fillRoundedRect(cx + 10, cy + cardSize - 32, (cardSize - 20) * pct, 18, 4);
        container.add(bar);
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 31, `${((pct)*100).toFixed(0)}%`, {
          fontSize: '12px', fontFamily: 'monospace', color: '#ffffff',
        }).setOrigin(0.5, 0));
      } else if (canStart) {
        const btnW = 90;
        const btnH = 28;
        const btnX = cx + (cardSize - btnW) / 2;
        const btnY = cy + cardSize - btnH - 8;
        const btn = this.add.graphics();
        btn.fillStyle(0x44aa44, 0.9);
        btn.fillRoundedRect(btnX, btnY, btnW, btnH, 4);
        container.add(btn);
        container.add(this.add.text(cx + cardSize / 2, btnY + 5, 'START', {
          fontSize: '14px', fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5, 0));

        const clickZone = this.add.rectangle(
          startX + btnX + btnW / 2, startY + btnY + btnH / 2, btnW, btnH, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(3205);
        this.researchElements.push(clickZone);
        const capturedId = id;
        clickZone.on('pointerdown', () => {
          const gs = this.scene.get('GameScene');
          if (gs?.socket) gs.socket.send({ type: 'research_start', id: capturedId });
        });
      } else if (isLocked) {
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 28, 'LOCKED', {
          fontSize: '13px', fontFamily: 'monospace', color: '#333344',
        }).setOrigin(0.5, 0));
      } else {
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 28, 'NEED RES', {
          fontSize: '13px', fontFamily: 'monospace', color: '#553333',
        }).setOrigin(0.5, 0));
      }

      // Cancel for active
      if (isActive) {
        const cbtn = this.add.graphics();
        cbtn.fillStyle(0x663333, 0.8);
        cbtn.fillRoundedRect(cx + cardSize - 26, cy + 5, 22, 22, 4);
        container.add(cbtn);
        container.add(this.add.text(cx + cardSize - 15, cy + 7, 'X', {
          fontSize: '14px', fontFamily: 'monospace', color: '#ff8888', fontStyle: 'bold',
        }).setOrigin(0.5, 0));

        const cancelZone = this.add.rectangle(
          startX + cx + cardSize - 15, startY + cy + 16, 22, 22, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(3205);
        this.researchElements.push(cancelZone);
        cancelZone.on('pointerdown', () => {
          const gs = this.scene.get('GameScene');
          if (gs?.socket) gs.socket.send({ type: 'research_cancel' });
        });
      }
    }
  }

  isPointInResearch(screenX, screenY) {
    if (!this.researchOpen || !this.researchContainer) return false;
    const c = this.researchContainer;
    return (
      screenX >= c.x && screenX <= c.x + (this._resPanelW || 0) &&
      screenY >= c.y && screenY <= c.y + (this._resPanelH || 0)
    );
  }

  closeResearch() {
    this.researchOpen = false;
    if (this._resDragCleanup) {
      this._resDragCleanup();
      this._resDragCleanup = null;
    }
    for (const el of this.researchElements) el.destroy();
    this.researchElements = [];
    this.researchContainer = null;
  }

  // ── Chat ──

  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;

    // Create DOM input element
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = 'Type a message...';
    input.style.cssText = `
      position: fixed;
      bottom: 90px;
      left: 50%;
      transform: translateX(-50%);
      width: 500px;
      padding: 8px 14px;
      background: rgba(10,14,20,0.92);
      border: 1px solid rgba(0,255,136,0.3);
      border-radius: 6px;
      color: #e6edf3;
      font-size: 14px;
      font-family: monospace;
      outline: none;
      z-index: 10000;
    `;

    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // prevent game keys from firing
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) {
          const gameScene = this.scene.get('GameScene');
          if (gameScene?.socket) {
            gameScene.socket.send({ type: 'chat', text });
          }
        }
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });

    document.body.appendChild(input);
    this._chatInput = input;
    // Focus after a tiny delay so the backtick doesn't get typed
    setTimeout(() => input.focus(), 50);
    // Show full chat history while typing
    this._renderChatLog();
  }

  closeChat() {
    this.chatOpen = false;
    if (this._chatInput) {
      this._chatInput.remove();
      this._chatInput = null;
    }
    this._renderChatLog();
  }

  addChatMessage(name, text) {
    const now = Date.now();
    this.chatMessages.push({ name, text, t: now, alpha: 1 });
    // Keep max 50 messages
    if (this.chatMessages.length > 50) this.chatMessages.shift();
    this._renderChatLog();
  }

  _renderChatLog() {
    for (const t of this.chatTexts) t.destroy();
    this.chatTexts = [];

    const cam = this.cameras.main;
    const x = 12;
    const isOpen = this.chatOpen;
    const maxVisible = isOpen ? 20 : 8;
    const lineH = 18;
    const baseY = isOpen ? cam.height - 110 : cam.height - 160;

    const visible = this.chatMessages.slice(-maxVisible);

    // Calculate which messages are actually visible (not fully faded)
    const now = Date.now();
    const visibleMsgs = [];
    visible.forEach((msg, i) => {
      const age = (now - msg.t) / 1000;
      let alpha;
      if (isOpen) alpha = 1;
      else if (age < 8) alpha = 1;
      else if (age < 12) alpha = 1 - (age - 8) / 4;
      else alpha = 0;
      if (alpha > 0) visibleMsgs.push({ msg, i, alpha });
    });

    // Dark background behind all visible messages
    if (visibleMsgs.length > 0) {
      const topIdx = visibleMsgs[0].i;
      const botIdx = visibleMsgs[visibleMsgs.length - 1].i;
      const topY = baseY - (visible.length - 1 - topIdx) * lineH;
      const bgH = (botIdx - topIdx + 1) * lineH + 8;
      const maxAlpha = isOpen ? 0.7 : Math.max(...visibleMsgs.map(v => v.alpha)) * 0.5;
      const bg = this.add.graphics().setDepth(849);
      bg.fillStyle(0x000000, maxAlpha);
      bg.fillRoundedRect(4, topY - 4, 460, bgH, 4);
      this.chatTexts.push(bg);
    }

    visibleMsgs.forEach(({ msg, i, alpha }) => {
      const y = baseY - (visible.length - 1 - i) * lineH;

      const nameText = this.add.text(x, y, `${msg.name}:`, {
        fontSize: '12px', fontFamily: 'monospace',
        color: '#00cc77', fontStyle: 'bold',
      }).setDepth(850).setAlpha(alpha);

      const msgText = this.add.text(x + nameText.width + 6, y, msg.text, {
        fontSize: '12px', fontFamily: 'monospace',
        color: '#ccccdd',
      }).setDepth(850).setAlpha(alpha);

      this.chatTexts.push(nameText);
      this.chatTexts.push(msgText);
    });
  }

  updateChat() {
    // Called every frame — handle fading
    if (this.chatMessages.length === 0) return;

    // Check if any visible messages need alpha update
    const now = Date.now();
    let needsRedraw = false;
    for (const msg of this.chatMessages) {
      const age = (now - msg.t) / 1000;
      if (age >= 8 && age <= 13) {
        needsRedraw = true;
        break;
      }
    }
    if (needsRedraw) this._renderChatLog();
  }
}
