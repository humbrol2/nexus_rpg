import Phaser from 'phaser';

// ITEM_INFO is populated from server registry on init
// Start with empty, filled by loadRegistry()
const ITEM_INFO = {};

/**
 * Create a close button (✕) with invisible hitbox and hover effect.
 * @param {Phaser.Scene} scene
 * @param {number} x - right edge x of the button (text is right-aligned)
 * @param {number} y - top y of the button
 * @param {string} color - default color hex string
 * @param {number} depth - z-depth for the hitbox
 * @param {Function} onClose - callback when clicked
 * @returns {{ btn: Phaser.GameObjects.Text, hit: Phaser.GameObjects.Rectangle }}
 */
function createCloseButton(scene, x, y, color, depth, onClose) {
  const btn = scene.add.text(x, y, '\u2715', {
    fontSize: '18px', fontFamily: 'monospace', color,
  }).setOrigin(1, 0).setDepth(depth);
  const hit = scene.add.rectangle(x - 9, y + 8, 24, 24, 0x000000, 0)
    .setInteractive({ useHandCursor: true }).setDepth(depth + 1);
  hit.on('pointerover', () => btn.setColor('#ff6644'));
  hit.on('pointerout', () => btn.setColor(color));
  hit.on('pointerup', () => onClose());
  return { btn, hit };
}

/**
 * Load item registry from server init data.
 * Called once on connect — populates ITEM_INFO, tile labels, crafting menu.
 */
export function loadRegistry(data) {
  // Build ITEM_INFO from server items
  for (const [key, item] of Object.entries(data.items || {})) {
    ITEM_INFO[key] = {
      color: item.color,
      label: item.label,
    };
    // Add placeable info if present
    if (item.placeable) {
      ITEM_INFO[key].placeable = {
        type: 'build',
        item: item.placeable.build_key,
        tileId: item.placeable.tile_id,
      };
    }
    // Machine items — placeable as machines
    if (item.machine_type) {
      ITEM_INFO[key].placeable = {
        type: 'machine',
        machine_type: item.machine_type,
      };
    }
  }

  // Build tile RGB lookup for minimap
  ITEM_INFO._tileRGB = {};
  for (const [tid, tile] of Object.entries(data.tiles || {})) {
    ITEM_INFO._tileRGB[Number(tid)] = tile.color;
  }

  // Add machine toolbar items
  for (const [tid, machine] of Object.entries(data.machines || {})) {
    const tile = data.tiles?.[tid];
    const color = tile ? `#${tile.color.map(c => c.toString(16).padStart(2,'0')).join('')}` : '#888888';
    ITEM_INFO[`_build_machine_${tid}`] = {
      color,
      label: machine.name,
      buildable: true,
    };
  }
}

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
    this.craftDetailOpen = false;
    this.craftDetailElements = [];

    // World map
    this.worldMapOpen = false;
    this.worldMapElements = [];

    // Help overlay
    this.helpOpen = false;
    this.helpElements = [];

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
    this.coordText = this.add.text(10, 42, '', {
      fontSize: '14px', fontFamily: 'monospace',
      color: '#00ff88', backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    }).setDepth(1000);

    this.statusText = this.add.text(10, 66, 'Connecting...', {
      fontSize: '13px', fontFamily: 'monospace',
      color: '#ffaa00', backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    }).setDepth(1000);

    this.tileInfoText = this.add.text(10, 90, '', {
      fontSize: '12px', fontFamily: 'monospace',
      color: '#aaaacc', backgroundColor: '#000000aa',
      padding: { x: 6, y: 3 },
    }).setDepth(1000);

    // Zone display (top-left, below coords)
    this.zoneText = this.add.text(10, 112, '', {
      fontSize: '13px', fontFamily: 'monospace',
      color: '#44aa66', backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    }).setDepth(1000);

    // Toast
    this.toastText = this.add.text(
      this.cameras.main.width / 2, 80, '', {
        fontSize: '14px', fontFamily: 'monospace',
        color: '#ffffff', backgroundColor: '#33aa5588',
        padding: { x: 10, y: 6 },
      }
    ).setOrigin(0.5).setDepth(1001).setVisible(false);

    // Hint text (bottom-left, fades after a few seconds)
    const cam = this.cameras.main;

    // Z-level indicator (top-center, only visible underground)
    this._zLevelText = this.add.text(cam.width / 2, 42, '', {
      fontSize: '16px', fontFamily: 'monospace',
      color: '#ff8844', fontStyle: 'bold',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5, 0).setDepth(1001).setVisible(false);
    this.hintText = this.add.text(10, cam.height - 24,
      'Press H for help  |  ` for chat', {
        fontSize: '11px', fontFamily: 'monospace',
        color: '#556655', backgroundColor: '#000000aa',
        padding: { x: 6, y: 3 },
      }
    ).setDepth(1000);
    // Fade out after 15 seconds
    this.time.delayedCall(15000, () => {
      this.tweens.add({
        targets: this.hintText, alpha: 0, duration: 2000,
        onComplete: () => this.hintText.setVisible(false),
      });
    });

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
    this._toolbarSlotSize = 65;
    this._toolbarPad = 5;
    this._loadToolbar();
    this._registryLoaded = false;
    this._renderToolbar();
  }

  onRegistryLoaded() {
    this._registryLoaded = true;
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
      let itemKey = this.toolbarSlots[i];
      const info = itemKey ? ITEM_INFO[itemKey] : null;
      const isBuildable = info?.buildable;
      const count = itemKey ? (this.inventory[itemKey] || 0) : 0;

      // Auto-clear slot if item has 0 count (unless it's a toolbar/placeable action)
      // Don't clear until registry is loaded — ITEM_INFO might not have the item yet
      const isPlaceable = !!(info?.placeable);
      if (this._registryLoaded && itemKey && !isBuildable && !isPlaceable && count <= 0) {
        this.toolbarSlots[i] = null;
        itemKey = null;
      }

      const hasItem = itemKey && ITEM_INFO[itemKey];
      const isActive = i === this.activeToolbarSlot;

      const slotGfx = this.add.graphics().setDepth(901);
      if (isActive) {
        slotGfx.fillStyle(0x1a3322, 1);
        slotGfx.lineStyle(2, 0x00ff88, 0.8);
      } else if (hasItem) {
        slotGfx.fillStyle(0x151a22, 1);
        slotGfx.lineStyle(1, 0x334455, 0.5);
      } else {
        slotGfx.fillStyle(0x0c0f14, 0.8);
        slotGfx.lineStyle(1, 0x1a1e28, 0.4);
      }
      slotGfx.fillRoundedRect(sx, sy, slotSize, slotSize, 5);
      slotGfx.strokeRoundedRect(sx, sy, slotSize, slotSize, 5);

      if (hasItem) {
        const itemInfo = ITEM_INFO[itemKey];
        const swatchHex = parseInt(itemInfo.color.replace('#', ''), 16);
        const iconSize = 26;
        const iconX = sx + (slotSize - iconSize) / 2;
        const iconY = sy + 5;
        slotGfx.fillStyle(swatchHex, 1);
        slotGfx.fillRoundedRect(iconX, iconY, iconSize, iconSize, 4);
        slotGfx.fillStyle(0xffffff, 0.15);
        slotGfx.fillRect(iconX + 2, iconY + 2, iconSize - 4, 5);

        // Label
        const label = this.add.text(sx + slotSize / 2, sy + 34, itemInfo.label.slice(0, 7), {
          fontSize: '9px', fontFamily: 'monospace',
          color: itemInfo.color,
        }).setOrigin(0.5, 0).setDepth(902);
        this.toolbarElements.push(label);

        // Count (skip for buildable actions)
        if (!isBuildable && count > 0) {
          const countText = this.add.text(sx + slotSize / 2, sy + 46, String(count), {
            fontSize: '11px', fontFamily: 'monospace', fontStyle: 'bold',
            color: '#ffffff',
          }).setOrigin(0.5, 0).setDepth(902);
          this.toolbarElements.push(countText);
        }
      }

      // Slot number
      const numText = this.add.text(sx + 4, sy + 3, String((i + 1) % 10), {
        fontSize: '10px', fontFamily: 'monospace',
        color: isActive ? '#00ff88' : '#445566',
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
      for (let i = 0; i < this.toolbarSlots.length; i++) {
        if (this.toolbarSlots[i] === itemKey) this.toolbarSlots[i] = null;
      }
      this.toolbarSlots[index] = itemKey;
      this._saveToolbar();
      this._renderToolbar();
    }
  }

  _saveToolbar() {
    localStorage.setItem('sc_toolbar', JSON.stringify(this.toolbarSlots));
  }

  _loadToolbar() {
    const saved = localStorage.getItem('sc_toolbar');
    if (saved) {
      try {
        const slots = JSON.parse(saved);
        if (Array.isArray(slots) && slots.length === this.toolbarSlots.length) {
          this.toolbarSlots = slots;
        }
      } catch (e) { /* ignore */ }
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

    // Build tile colors from registry
    const TILE_RGB = ITEM_INFO._tileRGB || {};

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

  updateZone(name, color) {
    if (this.zoneText) {
      this.zoneText.setText(name);
      this.zoneText.setColor(color);
    }
  }

  setStatus(text) {
    this.statusText.setText(text);
  }

  setZLevel(z) {
    if (this._zLevelText) {
      this._zLevelText.setText(z === 0 ? '' : `UNDERGROUND ${z}`);
      this._zLevelText.setVisible(z !== 0);
    }
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
    // Route to chest UI for chest types
    if (machine.machine_type >= 204 && machine.machine_type <= 207) {
      this.showChestUI(machine);
      return;
    }

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

    const { btn: machCloseBtn, hit: machCloseHit } = createCloseButton(
      this, px + panelW - 12, py + 6, '#334466', 2001, () => this.closeMachineUI()
    );
    this.machineUIElements.push(machCloseBtn, machCloseHit);

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

  // ── Chest UI (grid-based) ──

  showChestUI(machine) {
    this.closeMachineUI();
    this.machineUIOpen = true;
    this.machineUIData = machine;

    const cam = this.cameras.main;
    const cols = 6;
    const cellSize = 68;
    const cellPad = 5;
    const titleBarH = 36;
    const pad = 12;
    const totalItems = Object.values(machine.inventory).reduce((a, b) => a + b, 0);
    const maxSlots = machine.max_storage || 50;
    const displaySlots = Math.max(Object.keys(machine.inventory).length, Math.min(maxSlots, 18), 6);
    const rows = Math.ceil(displaySlots / cols);
    const gridW = cols * (cellSize + cellPad) - cellPad;
    const panelW = gridW + pad * 2;
    const controlH = 28;
    const panelH = titleBarH + pad + rows * (cellSize + cellPad) - cellPad + pad + controlH;

    const startX = this._chestPosX ?? (cam.width / 2 - panelW - 10);
    const startY = this._chestPosY ?? (cam.height - panelH) / 2;

    const container = this.add.container(startX, startY).setDepth(4000);
    this.machineUIElements.push(container);

    // Panel background
    const bg = this.add.graphics();
    bg.fillStyle(0x0d1117, 0.95);
    bg.fillRoundedRect(0, 0, panelW, panelH, 8);
    bg.lineStyle(1, 0xcc8833, 0.4);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 8);
    container.add(bg);

    // Title bar
    const titleBar = this.add.graphics();
    titleBar.fillStyle(0x1a1510, 1);
    titleBar.fillRoundedRect(0, 0, panelW, titleBarH, { tl: 8, tr: 8, bl: 0, br: 0 });
    titleBar.lineStyle(1, 0xcc8833, 0.2);
    titleBar.lineBetween(0, titleBarH, panelW, titleBarH);
    container.add(titleBar);

    container.add(this.add.text(pad, 10, `${machine.name}  (${totalItems}/${maxSlots})`, {
      fontSize: '14px', fontFamily: 'monospace', color: '#cc8833', fontStyle: 'bold',
    }));

    const { btn: chestCloseBtn, hit: chestCloseHit } = createCloseButton(
      this, startX + panelW - pad, startY + 6, '#664433', 4005, () => this.closeMachineUI()
    );
    container.add(chestCloseBtn);
    this.machineUIElements.push(chestCloseHit);

    // Drag title bar
    let dragging = false;
    let dragOffX = 0, dragOffY = 0;
    const dragHit = this.add.rectangle(
      startX + panelW / 2, startY + titleBarH / 2,
      panelW, titleBarH, 0x000000, 0
    ).setInteractive({ useHandCursor: true }).setDepth(4003);
    this.machineUIElements.push(dragHit);

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
      this._chestPosX = container.x;
      this._chestPosY = container.y;
    };
    const onUp = () => { dragging = false; };
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this._chestDragCleanup = () => {
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
    };

    // Grid
    const chestItems = Object.entries(machine.inventory);
    for (let i = 0; i < displaySlots; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = pad + col * (cellSize + cellPad);
      const cy = titleBarH + pad + row * (cellSize + cellPad);

      const entry = chestItems[i];
      const cell = this.add.graphics();

      if (entry) {
        const [itemKey, count] = entry;
        const info = ITEM_INFO[itemKey];
        const colorHex = info ? parseInt(info.color.replace('#', ''), 16) : 0x888888;
        const label = info ? info.label : itemKey;

        cell.fillStyle(0x1a1a10, 1);
        cell.fillRoundedRect(cx, cy, cellSize, cellSize, 5);
        cell.lineStyle(1, colorHex, 0.5);
        cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 5);

        // Icon swatch
        const iconSize = 26;
        const iconX = cx + (cellSize - iconSize) / 2;
        const iconY = cy + 5;
        cell.fillStyle(colorHex, 1);
        cell.fillRoundedRect(iconX, iconY, iconSize, iconSize, 4);
        cell.fillStyle(0xffffff, 0.18);
        cell.fillRect(iconX + 2, iconY + 2, iconSize - 4, 6);

        container.add(cell);

        container.add(this.add.text(cx + cellSize / 2, cy + 35, label, {
          fontSize: '9px', fontFamily: 'monospace', color: info?.color || '#888888',
        }).setOrigin(0.5, 0));

        container.add(this.add.text(cx + cellSize / 2, cy + 49, String(count), {
          fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
        }).setOrigin(0.5, 0));

        // Click to withdraw
        const clickZone = this.add.rectangle(
          startX + cx + cellSize / 2, startY + cy + cellSize / 2,
          cellSize, cellSize, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(4005);
        this.machineUIElements.push(clickZone);

        const capturedItem = itemKey;
        const capturedCount = count;
        clickZone.on('pointerup', (pointer) => {
          const gs = this.scene.get('GameScene');
          if (!gs?.socket) return;
          // Shift+click = full stack, normal click = 1
          const amt = pointer.event.shiftKey ? capturedCount : 1;
          gs.socket.send({
            type: 'chest_withdraw_item',
            wx: machine.wx, wy: machine.wy,
            item: capturedItem, count: amt,
          });
        });
      } else {
        cell.fillStyle(0x0a0a08, 0.5);
        cell.fillRoundedRect(cx, cy, cellSize, cellSize, 5);
        cell.lineStyle(1, 0x151510, 0.3);
        cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 5);
        container.add(cell);
      }
    }

    // Controls bar
    const ctrlY = panelH - controlH;
    container.add(this.add.text(pad, ctrlY + 6,
      'Click: take 1 | Shift+Click: take all | Open [I]nventory to deposit', {
        fontSize: '9px', fontFamily: 'monospace', color: '#554433',
      }));

    // Empty message
    if (chestItems.length === 0) {
      container.add(this.add.text(panelW / 2, titleBarH + pad + 20, 'Empty — open inventory to deposit items', {
        fontSize: '11px', fontFamily: 'monospace', color: '#443322',
      }).setOrigin(0.5, 0));
    }

    // Auto-open inventory for deposit
    if (!this.inventoryOpen) {
      this.showInventory();
    }
  }

  closeMachineUI() {
    this.machineUIOpen = false;
    this.machineUIData = null;
    if (this._chestDragCleanup) {
      this._chestDragCleanup();
      this._chestDragCleanup = null;
    }
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

    // Only show items the player actually has (no buildables — those go in crafting menu)
    const ownedItems = Object.entries(ITEM_INFO).filter(([key, info]) => !info.buildable && (this.inventory[key] || 0) > 0);
    const cols = 6;
    const cellSize = 68;
    const cellPad = 5;
    const titleBarH = 32;
    const pad = 12;
    const minSlots = Math.max(ownedItems.length, 6);
    const invRows = Math.ceil(minSlots / cols);
    const gridW = cols * (cellSize + cellPad) - cellPad;
    const panelW = gridW + pad * 2;
    const panelH = titleBarH + pad + invRows * (cellSize + cellPad) - cellPad + pad;

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

    const { btn: invCloseBtn, hit: invCloseHit } = createCloseButton(
      this, startX + panelW - pad, startY + 5, '#335544', 3005, () => this.closeInventory()
    );
    container.add(invCloseBtn);
    this.inventoryElements.push(invCloseHit);

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
          this._invClickTime = Date.now();
        });

        dragHandle.on('pointerup', (pointer) => {
          if (!isDragging && Date.now() - (this._invClickTime || 0) < 300) {
            // If chest is open, deposit to chest instead
            if (this.machineUIOpen && this.machineUIData &&
                this.machineUIData.machine_type >= 204 && this.machineUIData.machine_type <= 207) {
              const gs = this.scene.get('GameScene');
              if (gs) {
                const amt = pointer.event.shiftKey ? (this.inventory[capturedKey] || 1) : 1;
                gs._depositToMachine(capturedKey, amt);
              }
              return;
            }
            // Special items — handle directly
            if (capturedKey === 'claim_flag') {
              const gs = this.scene.get('GameScene');
              if (gs?.socket) gs.socket.send({ type: 'place_claim' });
              this.showToast('Placing claim flag at your position...');
              return;
            }
            // Only assign placeable items to toolbar on click
            const itemInfo = ITEM_INFO[capturedKey];
            if (itemInfo?.placeable) {
              let slotIdx = this.toolbarSlots.indexOf(capturedKey);
              if (slotIdx === -1) {
                slotIdx = this.toolbarSlots.indexOf(null);
                if (slotIdx === -1) slotIdx = 0;
                this.assignToolbarSlot(slotIdx, capturedKey);
              }
              this.selectToolbarSlot(slotIdx);
              this.showToast(`Selected: ${itemInfo.label} — click ground to place`);
            } else {
              this.showToast(`${info.label}: ${count}`);
            }
          }
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

  // ── Help Overlay ──

  toggleHelp() {
    if (this.helpOpen) {
      this.closeHelp();
    } else {
      this.showHelp();
    }
  }

  showHelp() {
    this.closeHelp();
    this.helpOpen = true;

    const cam = this.cameras.main;
    const panelW = 520;
    const panelH = 310;
    const px = (cam.width - panelW) / 2;
    const py = (cam.height - panelH) / 2;

    // Dimmed background
    const dim = this.add.graphics().setDepth(9000);
    dim.fillStyle(0x000000, 0.7);
    dim.fillRect(0, 0, cam.width, cam.height);
    this.helpElements.push(dim);

    const container = this.add.container(px, py).setDepth(9001);
    this.helpElements.push(container);

    // Panel
    const bg = this.add.graphics();
    bg.fillStyle(0x0d1117, 0.97);
    bg.fillRoundedRect(0, 0, panelW, panelH, 10);
    bg.lineStyle(1, 0x00ff88, 0.3);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 10);
    container.add(bg);

    const ts = { fontSize: '11px', fontFamily: 'monospace', color: '#ccddcc' };
    const hs = { fontSize: '11px', fontFamily: 'monospace', color: '#00ff88', fontStyle: 'bold' };
    const ks = { fontSize: '11px', fontFamily: 'monospace', color: '#ffcc44' };

    container.add(this.add.text(panelW / 2, 12, 'CONTROLS', {
      fontSize: '15px', fontFamily: 'monospace', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    const { btn: helpCloseBtn, hit: helpCloseHit } = createCloseButton(
      this, px + panelW - 14, py + 8, '#335544', 9001, () => this.closeHelp()
    );
    container.add(helpCloseBtn);
    this.helpElements.push(helpCloseHit);

    // Two-column layout
    const colL = 16;   // left column x
    const colR = 270;  // right column x
    const keyW = 100;  // key label width

    const addSection = (x, yPos, title) => {
      container.add(this.add.text(x, yPos, title, hs));
      return yPos + 17;
    };
    const addRow = (x, yPos, key, desc) => {
      container.add(this.add.text(x + 4, yPos, key, ks));
      container.add(this.add.text(x + keyW, yPos, desc, ts));
      return yPos + 15;
    };

    // Left column
    let yL = 40;
    yL = addSection(colL, yL, 'MOVEMENT');
    yL = addRow(colL, yL, 'W A S D', 'Move');
    yL = addRow(colL, yL, 'Scroll', 'Zoom in/out');
    yL += 4;
    yL = addSection(colL, yL, 'PANELS');
    yL = addRow(colL, yL, 'I', 'Inventory');
    yL = addRow(colL, yL, 'C', 'Crafting');
    yL = addRow(colL, yL, 'R', 'Research');
    yL = addRow(colL, yL, 'M / TAB', 'World map');
    yL = addRow(colL, yL, 'H', 'Help (this)');
    yL += 4;
    yL = addSection(colL, yL, 'ACTIONS');
    yL = addRow(colL, yL, 'L-Click', 'Mine / place / interact');
    yL = addRow(colL, yL, 'R-Click', 'Pick up building');
    yL = addRow(colL, yL, 'E', 'Interact at cursor');
    yL = addRow(colL, yL, '1-9, 0', 'Select toolbar slot');
    yL = addRow(colL, yL, 'ESC', 'Cancel action');

    // Right column
    let yR = 40;
    yR = addSection(colR, yR, 'MACHINES & CHESTS');
    yR = addRow(colR, yR, 'L-Click', 'Open UI');
    yR = addRow(colR, yR, 'G', 'Grab all items');
    yR = addRow(colR, yR, 'Q', 'Close UI');
    yR = addRow(colR, yR, 'Shift+Click', 'Transfer stack');
    yR += 4;
    yR = addSection(colR, yR, 'CHAT');
    yR = addRow(colR, yR, '`  (backtick)', 'Open chat');
    yR = addRow(colR, yR, 'Enter', 'Send message');
    yR = addRow(colR, yR, 'Escape', 'Close chat');
    yR += 4;
    yR = addSection(colR, yR, 'UNDERGROUND');
    yR = addRow(colR, yR, 'Stairs Down', 'Craft & place to descend');
    yR = addRow(colR, yR, 'Stairs Up', 'Craft & place to ascend');
    yR = addRow(colR, yR, 'Click stair', 'Use while standing on it');

    // Click anywhere to close
    const closeHit = this.add.rectangle(
      cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0
    ).setInteractive().setDepth(9000);
    this.helpElements.push(closeHit);
    closeHit.on('pointerup', () => this.closeHelp());
  }

  closeHelp() {
    this.helpOpen = false;
    for (const el of this.helpElements) el.destroy();
    this.helpElements = [];
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
    if (this._craftActiveTab === undefined) this._craftActiveTab = 0;

    const cam = this.cameras.main;
    const sections = this.craftingMenuData || [];
    if (sections.length === 0) return;

    const activeTab = Math.min(this._craftActiveTab, sections.length - 1);
    const activeSection = sections[activeTab];

    // Grid layout for items
    const cols = 4;
    const cellSize = 120;
    const cellPad = 8;
    const titleBarH = 44;
    const tabBarH = 40;
    const pad = 16;
    const gridRows = Math.ceil(activeSection.items.length / cols);
    const panelW = pad * 2 + cols * (cellSize + cellPad) - cellPad;
    const panelH = titleBarH + tabBarH + pad + gridRows * (cellSize + cellPad) - cellPad + pad;

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

    container.add(this.add.text(pad, 11, 'CRAFTING', {
      fontSize: '20px', fontFamily: 'monospace', color: '#ffcc44', fontStyle: 'bold',
    }));
    const { btn: craftCloseBtn, hit: craftCloseHit } = createCloseButton(
      this, startX + panelW - pad, startY + 10, '#554433', 3105, () => this.closeCrafting()
    );
    container.add(craftCloseBtn);
    this.craftingElements.push(craftCloseHit);

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

    // Tab bar — short labels to prevent overlap
    const tabW = (panelW - pad * 2) / sections.length;
    sections.forEach((section, i) => {
      const tx = pad + i * tabW;
      const ty = titleBarH;
      const isActive = i === activeTab;
      const col = parseInt(section.color.replace('#', ''), 16);

      const tabBg = this.add.graphics();
      tabBg.fillStyle(isActive ? 0x1a2020 : 0x0e1015, 1);
      tabBg.fillRect(tx, ty, tabW - 2, tabBarH);
      if (isActive) {
        tabBg.fillStyle(col, 0.8);
        tabBg.fillRect(tx, ty + tabBarH - 3, tabW - 2, 3);
      }
      container.add(tabBg);

      // Truncate title to fit tab
      const maxChars = Math.max(4, Math.floor(tabW / 8));
      const tabLabel = section.title.length > maxChars ? section.title.slice(0, maxChars) : section.title;
      container.add(this.add.text(tx + tabW / 2, ty + 12, tabLabel, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isActive ? section.color : '#556666',
        fontStyle: isActive ? 'bold' : 'normal',
      }).setOrigin(0.5, 0));

      const tabZone = this.add.rectangle(
        startX + tx + tabW / 2, startY + ty + tabBarH / 2,
        tabW, tabBarH, 0x000000, 0
      ).setInteractive({ useHandCursor: true }).setDepth(3104);
      this.craftingElements.push(tabZone);
      tabZone.on('pointerdown', () => {
        this._craftActiveTab = i;
        this.showCrafting();
      });
    });

    // Render active tab items as grid squares
    activeSection.items.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = pad + col * (cellSize + cellPad);
      const cy = titleBarH + tabBarH + pad + row * (cellSize + cellPad);

      const canCraft = Object.entries(item.cost).every(
        ([k, v]) => (this.inventory[k] || 0) >= v
      );

      // Cell background
      const cell = this.add.graphics();
      cell.fillStyle(canCraft ? 0x1a2a1a : 0x111115, 1);
      cell.fillRoundedRect(cx, cy, cellSize, cellSize, 6);
      cell.lineStyle(1, canCraft ? 0x33aa44 : 0x222233, canCraft ? 0.5 : 0.3);
      cell.strokeRoundedRect(cx, cy, cellSize, cellSize, 6);
      container.add(cell);

      // Item name (centered, top)
      container.add(this.add.text(cx + cellSize / 2, cy + 8, item.name, {
        fontSize: '12px', fontFamily: 'monospace', fontStyle: 'bold',
        color: canCraft ? '#ddddee' : '#556666',
        wordWrap: { width: cellSize - 10 }, align: 'center',
      }).setOrigin(0.5, 0));

      // Cost (centered, middle)
      const costStr = Object.entries(item.cost).map(([k, v]) => {
        const have = this.inventory[k] || 0;
        return `${(ITEM_INFO[k]?.label || k).slice(0, 6)}:${have}/${v}`;
      }).join('\n');
      container.add(this.add.text(cx + cellSize / 2, cy + 45, costStr, {
        fontSize: '9px', fontFamily: 'monospace',
        color: canCraft ? '#66aa77' : '#553333',
        align: 'center', lineSpacing: 2,
      }).setOrigin(0.5, 0));

      // Note or machine tag (bottom)
      if (item.note) {
        container.add(this.add.text(cx + cellSize / 2, cy + cellSize - 18, item.note, {
          fontSize: '9px', fontFamily: 'monospace', color: '#667755',
        }).setOrigin(0.5, 0));
      } else if (item.machine) {
        container.add(this.add.text(cx + cellSize / 2, cy + cellSize - 18, 'machine', {
          fontSize: '9px', fontFamily: 'monospace', color: '#556644',
        }).setOrigin(0.5, 0));
      }

      // Click zone
      const clickZone = this.add.rectangle(
        startX + cx + cellSize / 2, startY + cy + cellSize / 2,
        cellSize, cellSize, 0x000000, 0
      ).setInteractive({ useHandCursor: true }).setDepth(3103);
      this.craftingElements.push(clickZone);

      const capturedItem = { ...item };
      clickZone.on('pointerdown', () => {
        this._showCraftDetail(capturedItem);
      });
    });
  }

  _showCraftDetail(item) {
    this._closeCraftDetail();
    this.craftDetailOpen = true;

    const cam = this.cameras.main;
    const popW = 300;
    const popH = 220;
    const px = (cam.width - popW) / 2;
    const py = (cam.height - popH) / 2;

    const ts = { fontSize: '12px', fontFamily: 'monospace', color: '#ccccdd' };
    let selectedQty = 1;

    // Overlay
    const overlay = this.add.graphics().setDepth(4500);
    overlay.fillStyle(0x000000, 0.5);
    overlay.fillRect(0, 0, cam.width, cam.height);
    this.craftDetailElements.push(overlay);

    // Panel
    const bg = this.add.graphics().setDepth(4501);
    bg.fillStyle(0x0d1117, 0.96);
    bg.fillRoundedRect(px, py, popW, popH, 10);
    bg.lineStyle(1, 0xffcc44, 0.4);
    bg.strokeRoundedRect(px, py, popW, popH, 10);
    this.craftDetailElements.push(bg);

    // Title
    this.craftDetailElements.push(
      this.add.text(px + popW / 2, py + 14, item.name, {
        fontSize: '16px', fontFamily: 'monospace', color: '#ffcc44', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(4502)
    );

    // Note (if any)
    if (item.note) {
      this.craftDetailElements.push(
        this.add.text(px + popW / 2, py + 36, item.note, {
          fontSize: '11px', fontFamily: 'monospace', color: '#889999',
        }).setOrigin(0.5, 0).setDepth(4502)
      );
    }

    // Cost per unit
    const costPerUnit = Object.entries(item.cost).map(([k, v]) => {
      const have = this.inventory[k] || 0;
      return `${k}: ${have}/${v}`;
    }).join('   ');
    this.craftDetailElements.push(
      this.add.text(px + popW / 2, py + 56, `Cost (x1): ${costPerUnit}`, {
        ...ts, fontSize: '11px', color: '#889999',
      }).setOrigin(0.5, 0).setDepth(4502)
    );

    // Total cost (updates with qty)
    const totalCostText = this.add.text(px + popW / 2, py + 76, '', {
      ...ts, fontSize: '12px',
    }).setOrigin(0.5, 0).setDepth(4502);
    this.craftDetailElements.push(totalCostText);

    // Qty buttons
    const qtyY = py + 105;
    const qtys = [1, 5, 10];
    const qtyButtons = [];

    const updateQty = (q) => {
      selectedQty = q;
      // Update total cost text
      const totalStr = Object.entries(item.cost).map(([k, v]) => {
        const need = v * q;
        const have = this.inventory[k] || 0;
        const ok = have >= need;
        return `${k}: ${have}/${need}`;
      }).join('   ');
      const canAfford = Object.entries(item.cost).every(([k, v]) => (this.inventory[k] || 0) >= v * q);
      totalCostText.setText(`Total (x${q}): ${totalStr}`);
      totalCostText.setColor(canAfford ? '#66aa77' : '#884444');

      // Update button highlights
      qtyButtons.forEach(({ btn, txt, val }) => {
        btn.clear();
        btn.fillStyle(val === q ? 0x44aa44 : 0x222233, val === q ? 0.9 : 0.8);
        btn.fillRoundedRect(0, 0, 60, 30, 4);
        btn.lineStyle(1, val === q ? 0x66cc66 : 0x333344, 0.6);
        btn.strokeRoundedRect(0, 0, 60, 30, 4);
        txt.setColor(val === q ? '#ffffff' : '#888899');
      });

      // Update craft button
      const canCraft = Object.entries(item.cost).every(([k, v]) => (this.inventory[k] || 0) >= v * q);
      craftBtn.clear();
      craftBtn.fillStyle(canCraft ? 0x44aa44 : 0x333344, 0.9);
      craftBtn.fillRoundedRect(0, 0, 120, 36, 5);
      craftBtnText.setColor(canCraft ? '#ffffff' : '#555555');
    };

    qtys.forEach((q, i) => {
      const bx = px + 50 + i * 75;
      const btn = this.add.graphics().setDepth(4502).setPosition(bx, qtyY);
      btn.fillStyle(q === 1 ? 0x44aa44 : 0x222233, q === 1 ? 0.9 : 0.8);
      btn.fillRoundedRect(0, 0, 60, 30, 4);
      btn.lineStyle(1, q === 1 ? 0x66cc66 : 0x333344, 0.6);
      btn.strokeRoundedRect(0, 0, 60, 30, 4);
      this.craftDetailElements.push(btn);

      const txt = this.add.text(bx + 30, qtyY + 7, `x${q}`, {
        fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
        color: q === 1 ? '#ffffff' : '#888899',
      }).setOrigin(0.5, 0).setDepth(4503);
      this.craftDetailElements.push(txt);

      qtyButtons.push({ btn, txt, val: q });

      const hitZone = this.add.rectangle(bx + 30, qtyY + 15, 60, 30, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(4504);
      this.craftDetailElements.push(hitZone);
      hitZone.on('pointerdown', () => updateQty(q));
    });

    // Craft button
    const craftBtnX = px + (popW - 120) / 2;
    const craftBtnY = py + 150;
    const craftBtn = this.add.graphics().setDepth(4502).setPosition(craftBtnX, craftBtnY);
    craftBtn.fillStyle(0x44aa44, 0.9);
    craftBtn.fillRoundedRect(0, 0, 120, 36, 5);
    this.craftDetailElements.push(craftBtn);

    const craftBtnText = this.add.text(craftBtnX + 60, craftBtnY + 9, 'CRAFT', {
      fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(4503);
    this.craftDetailElements.push(craftBtnText);

    const craftHitZone = this.add.rectangle(craftBtnX + 60, craftBtnY + 18, 120, 36, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(4504);
    this.craftDetailElements.push(craftHitZone);

    craftHitZone.on('pointerdown', () => {
      const canAfford = Object.entries(item.cost).every(([k, v]) => (this.inventory[k] || 0) >= v * selectedQty);
      if (!canAfford) { this.showToast('Not enough resources'); return; }

      const gameScene = this.scene.get('GameScene');
      if (gameScene?.socket) {
        if (item.machine) {
          this.showToast('Set recipe on machine (E to interact)');
        } else if (item.craft_id) {
          gameScene.socket.send({ type: 'hand_craft', item: item.craft_id, qty: selectedQty });
        }
      }
      this._closeCraftDetail();
    });

    // Close button
    this.craftDetailElements.push(
      this.add.text(px + popW - 14, py + 8, 'X', {
        fontSize: '14px', fontFamily: 'monospace', color: '#ff8888', fontStyle: 'bold',
      }).setOrigin(1, 0).setDepth(4503)
    );
    const closeZone = this.add.rectangle(px + popW - 10, py + 14, 20, 20, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(4504);
    this.craftDetailElements.push(closeZone);
    closeZone.on('pointerdown', () => this._closeCraftDetail());

    // ESC to close (handled by existing cancelAll)

    updateQty(1);
  }

  _closeCraftDetail() {
    this.craftDetailOpen = false;
    for (const el of this.craftDetailElements) el.destroy();
    this.craftDetailElements = [];
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
    this._closeCraftDetail();
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
    if (this._resActiveTab === undefined) this._resActiveTab = -1;

    const cam = this.cameras.main;
    const tree = this.researchTree;
    const state = this.researchState;
    const completed = new Set(state.completed || []);
    const margin = 30;
    const mapW = cam.width - margin * 2;
    const mapH = cam.height - margin * 2;

    // Dark overlay
    const overlay = this.add.graphics().setDepth(4500);
    overlay.fillStyle(0x000000, 0.85);
    overlay.fillRect(0, 0, cam.width, cam.height);
    this.researchElements.push(overlay);

    // Panel
    const border = this.add.graphics().setDepth(4501);
    border.fillStyle(0x0a0e14, 0.96);
    border.fillRoundedRect(margin, margin, mapW, mapH, 10);
    border.lineStyle(1, 0x8866ff, 0.3);
    border.strokeRoundedRect(margin, margin, mapW, mapH, 10);
    this.researchElements.push(border);

    // Title
    this.researchElements.push(
      this.add.text(cam.width / 2, margin + 12, 'RESEARCH TREE', {
        fontSize: '18px', fontFamily: 'monospace', color: '#8866ff', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(4510)
    );
    const { btn: resCloseBtn, hit: resCloseHit } = createCloseButton(
      this, cam.width - margin - 14, margin + 8, '#443366', 4510, () => this.closeResearch()
    );
    this.researchElements.push(resCloseBtn, resCloseHit);

    // Tier tabs
    const tiers = new Set();
    for (const node of Object.values(tree)) tiers.add(node.tier);
    const tierList = [-1, ...Array.from(tiers).sort()]; // -1 = ALL
    const tabBarY = margin + 38;
    const tabW = Math.min(80, (mapW - 20) / tierList.length);

    tierList.forEach((tier, i) => {
      const tx = margin + 10 + i * (tabW + 4);
      const isActive = tier === this._resActiveTab;
      const label = tier === -1 ? 'ALL' : `TIER ${tier}`;

      const tabBg = this.add.graphics().setDepth(4510);
      tabBg.fillStyle(isActive ? 0x221a33 : 0x0e1015, 1);
      tabBg.fillRoundedRect(tx, tabBarY, tabW, 24, 3);
      if (isActive) {
        tabBg.fillStyle(0x8866ff, 0.8);
        tabBg.fillRect(tx, tabBarY + 21, tabW, 3);
      }
      this.researchElements.push(tabBg);

      this.researchElements.push(
        this.add.text(tx + tabW / 2, tabBarY + 5, label, {
          fontSize: '10px', fontFamily: 'monospace',
          color: isActive ? '#aa88ff' : '#556666', fontStyle: isActive ? 'bold' : 'normal',
        }).setOrigin(0.5, 0).setDepth(4511)
      );

      const tabZone = this.add.rectangle(tx + tabW / 2, tabBarY + 12, tabW, 24, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(4512);
      this.researchElements.push(tabZone);
      tabZone.on('pointerdown', () => {
        this._resActiveTab = tier;
        this.showResearch();
      });
    });

    // Filter nodes by active tab
    const filteredNodes = Object.entries(tree).filter(([id, node]) =>
      this._resActiveTab === -1 || node.tier === this._resActiveTab
    );

    // Canvas area for cards
    const canvasY = tabBarY + 32;
    const canvasH = mapH - (canvasY - margin) - 10;
    const canvasW = mapW - 20;

    // Card layout
    const cardW = 200;
    const cardH = 180;
    const gapX = 40;
    const gapY = 24;

    // Pan/zoom state
    if (!this._resZoom) this._resZoom = 1;
    if (!this._resPanX) this._resPanX = 10;
    if (!this._resPanY) this._resPanY = 10;

    // Render cards into a container
    const container = this.add.container(margin + 10 + this._resPanX, canvasY + this._resPanY).setDepth(4502);
    this.researchContainer = container;
    this.researchElements.push(container);
    container.setScale(this._resZoom);

    // Clip mask (visual only — cards outside view still exist)
    const mask = this.add.graphics().setDepth(4501);
    mask.fillStyle(0x000000, 0);
    mask.fillRect(margin + 10, canvasY, canvasW, canvasH);

    // Tier colors
    const tierColors = { 1: 0x44aa66, 2: 0xaa8844, 3: 0xaa44aa, 4: 0xcc4444 };

    // Build node positions
    const nodePositions = {};
    for (const [id, node] of filteredNodes) {
      nodePositions[id] = {
        x: node.col * (cardW + gapX),
        y: node.row * (cardH + gapY),
      };
    }

    // Draw connector lines
    const lines = this.add.graphics();
    for (const [id, node] of filteredNodes) {
      const to = nodePositions[id];
      if (!to) continue;
      for (const prereqId of node.prereqs) {
        const from = nodePositions[prereqId];
        if (!from) continue;
        const isDone = completed.has(prereqId);
        lines.lineStyle(2, isDone ? 0x44aa66 : 0x222244, isDone ? 0.7 : 0.3);
        const midX = from.x + cardW + gapX / 2;
        lines.beginPath();
        lines.moveTo(from.x + cardW, from.y + cardH / 2);
        lines.lineTo(midX, from.y + cardH / 2);
        lines.lineTo(midX, to.y + cardH / 2);
        lines.lineTo(to.x, to.y + cardH / 2);
        lines.strokePath();
      }
    }
    container.add(lines);

    // Draw cards
    for (const [id, node] of filteredNodes) {
      const pos = nodePositions[id];
      if (!pos) continue;
      const cx = pos.x, cy = pos.y;

      const isCompleted = completed.has(id);
      const isActive = state.active === id;
      const prereqsMet = node.prereqs.every(p => completed.has(p));
      const canAfford = Object.entries(node.cost).every(([k, v]) => (this.inventory[k] || 0) >= v);
      const canStart = !isCompleted && !state.active && prereqsMet && canAfford;
      const isLocked = !prereqsMet && !isCompleted;
      const tierColor = tierColors[node.tier] || 0x888888;

      // Card bg
      const card = this.add.graphics();
      if (isCompleted) {
        card.fillStyle(0x1a2a1a, 1); card.lineStyle(2, 0x33aa44, 0.7);
      } else if (isActive) {
        card.fillStyle(0x1a1a2e, 1); card.lineStyle(2, 0x8866ff, 0.8);
      } else if (isLocked) {
        card.fillStyle(0x0c0c10, 0.8); card.lineStyle(1, 0x1a1a22, 0.4);
      } else if (canStart) {
        card.fillStyle(0x151a20, 1); card.lineStyle(2, 0xaaaa44, 0.6);
      } else {
        card.fillStyle(0x12151c, 1); card.lineStyle(1, 0x2a2a3a, 0.5);
      }
      card.fillRoundedRect(cx, cy, cardW, cardH, 8);
      card.strokeRoundedRect(cx, cy, cardW, cardH, 8);
      card.fillStyle(tierColor, isLocked ? 0.2 : 0.6);
      card.fillRect(cx + 5, cy + 5, cardW - 10, 5);
      container.add(card);

      // Tier badge
      container.add(this.add.text(cx + cardW - 10, cy + 10, `T${node.tier}`, {
        fontSize: '10px', fontFamily: 'monospace', color: `#${tierColor.toString(16).padStart(6, '0')}`,
      }).setOrigin(1, 0));

      // Name
      container.add(this.add.text(cx + cardW / 2, cy + 18, node.name, {
        fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold',
        color: isLocked ? '#333344' : (isCompleted ? '#55cc66' : '#ccccdd'),
      }).setOrigin(0.5, 0));

      // Description
      container.add(this.add.text(cx + cardW / 2, cy + 40, node.desc, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#222233' : '#889999',
        wordWrap: { width: cardW - 20 }, align: 'center',
      }).setOrigin(0.5, 0));

      // Unlocks
      const unlockStr = 'Unlocks: ' + (node.unlocks || []).join(', ');
      container.add(this.add.text(cx + cardW / 2, cy + 78, unlockStr, {
        fontSize: '10px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : '#668866',
        wordWrap: { width: cardW - 16 }, align: 'center',
      }).setOrigin(0.5, 0));

      // Cost
      const costLines = Object.entries(node.cost).map(([k, v]) => {
        const have = this.inventory[k] || 0;
        return `${k}: ${have}/${v}`;
      }).join('  ');
      container.add(this.add.text(cx + cardW / 2, cy + 110, costLines, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : (canAfford ? '#66aa77' : '#884444'),
        align: 'center',
      }).setOrigin(0.5, 0));

      // Time
      container.add(this.add.text(cx + cardW / 2, cy + 128, `Time: ${node.time}s`, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : '#556666',
      }).setOrigin(0.5, 0));

      // Status
      if (isCompleted) {
        container.add(this.add.text(cx + cardW / 2, cy + cardH - 28, 'COMPLETE', {
          fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold', color: '#33aa44',
        }).setOrigin(0.5, 0));
      } else if (isActive) {
        const pct = state.progress / node.time;
        const bar = this.add.graphics();
        bar.fillStyle(0x222233, 1);
        bar.fillRoundedRect(cx + 10, cy + cardH - 30, cardW - 20, 16, 4);
        bar.fillStyle(0x8866ff, 1);
        bar.fillRoundedRect(cx + 10, cy + cardH - 30, (cardW - 20) * pct, 16, 4);
        container.add(bar);
        container.add(this.add.text(cx + cardW / 2, cy + cardH - 29, `${(pct * 100).toFixed(0)}%`, {
          fontSize: '12px', fontFamily: 'monospace', color: '#ffffff',
        }).setOrigin(0.5, 0));
        this._resBar = bar;
        this._resBarX = cx + 10;
        this._resBarY = cy + cardH - 30;
        this._resBarW = cardW - 20;
        this._resNodeTime = node.time;
        this._resPctText = null; // will update via full redraw
      } else if (canStart) {
        const btnW = 100, btnH = 28;
        const btnX = cx + (cardW - btnW) / 2, btnY = cy + cardH - btnH - 8;
        const btn = this.add.graphics();
        btn.fillStyle(0x44aa44, 0.9);
        btn.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
        container.add(btn);
        container.add(this.add.text(cx + cardW / 2, btnY + 6, 'START', {
          fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
        }).setOrigin(0.5, 0));

        // Clickable — need screen position accounting for container offset + scale
        const screenBtnX = container.x + btnX * this._resZoom + btnW * this._resZoom / 2;
        const screenBtnY = container.y + btnY * this._resZoom + btnH * this._resZoom / 2;
        const clickZone = this.add.rectangle(screenBtnX, screenBtnY,
          btnW * this._resZoom, btnH * this._resZoom, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(4520);
        this.researchElements.push(clickZone);
        const capturedId = id;
        clickZone.on('pointerdown', () => {
          const gs = this.scene.get('GameScene');
          if (gs?.socket) gs.socket.send({ type: 'research_start', id: capturedId });
        });
      } else if (isLocked) {
        container.add(this.add.text(cx + cardW / 2, cy + cardH - 24, 'LOCKED', {
          fontSize: '13px', fontFamily: 'monospace', color: '#333344',
        }).setOrigin(0.5, 0));
      } else {
        container.add(this.add.text(cx + cardW / 2, cy + cardH - 24, 'NEED RESOURCES', {
          fontSize: '12px', fontFamily: 'monospace', color: '#553333',
        }).setOrigin(0.5, 0));
      }

      // Cancel for active
      if (isActive) {
        const cbtn = this.add.graphics();
        cbtn.fillStyle(0x663333, 0.8);
        cbtn.fillRoundedRect(cx + cardW - 26, cy + 6, 20, 20, 3);
        container.add(cbtn);
        container.add(this.add.text(cx + cardW - 16, cy + 8, 'X', {
          fontSize: '13px', fontFamily: 'monospace', color: '#ff8888', fontStyle: 'bold',
        }).setOrigin(0.5, 0));

        const screenCX = container.x + (cx + cardW - 16) * this._resZoom;
        const screenCY = container.y + (cy + 16) * this._resZoom;
        const cancelZone = this.add.rectangle(screenCX, screenCY, 20 * this._resZoom, 20 * this._resZoom, 0x000000, 0)
          .setInteractive({ useHandCursor: true }).setDepth(4520);
        this.researchElements.push(cancelZone);
        cancelZone.on('pointerdown', () => {
          const gs = this.scene.get('GameScene');
          if (gs?.socket) gs.socket.send({ type: 'research_cancel' });
        });
      }
    }

    // Pan via mouse drag
    let dragging = false, lastX = 0, lastY = 0;
    const hitZone = this.add.rectangle(
      margin + mapW / 2, canvasY + canvasH / 2, canvasW, canvasH, 0x000000, 0
    ).setInteractive().setDepth(4501);
    this.researchElements.push(hitZone);

    hitZone.on('pointerdown', (p) => { dragging = true; lastX = p.x; lastY = p.y; });
    const onMove = (p) => {
      if (!dragging) return;
      this._resPanX += p.x - lastX;
      this._resPanY += p.y - lastY;
      lastX = p.x; lastY = p.y;
      container.setPosition(margin + 10 + this._resPanX, canvasY + this._resPanY);
    };
    const onUp = () => { dragging = false; };

    // Zoom via scroll
    const onWheel = (pointer, gameObjects, dx, dy) => {
      this._resZoom = Phaser.Math.Clamp(this._resZoom - dy * 0.001, 0.3, 2);
      container.setScale(this._resZoom);
    };

    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this.input.on('wheel', onWheel);
    this._resDragCleanup = () => {
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
      this.input.off('wheel', onWheel);
    };

    // Legend
    const legY = margin + mapH - 20;
    this.researchElements.push(
      this.add.text(margin + 14, legY, 'Drag: pan | Scroll: zoom | Click card: start research', {
        fontSize: '10px', fontFamily: 'monospace', color: '#445555',
      }).setDepth(4510)
    );

    // Active research status bar
    if (state.active && tree[state.active]) {
      const an = tree[state.active];
      const pct = ((state.progress / an.time) * 100).toFixed(0);
      this.researchElements.push(
        this.add.text(cam.width - margin - 14, legY, `Researching: ${an.name} (${pct}%)`, {
          fontSize: '10px', fontFamily: 'monospace', color: '#aa88ff',
        }).setOrigin(1, 0).setDepth(4510)
      );
    }

  }

  _deadCodeRemoved() { return; // placeholder for removed old research code
    const cam_old = null;
    const tree = this.researchTree;
    const state = this.researchState;
    const completed = new Set(state.completed || []);

    // Grid layout
    const cardSize = 150;
    const gapX = 30;
    const gapY = 16;
    const pad = 18;
    const titleBarH = 40;

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

    const startX = this._resPosX ?? 0; // eslint fix — dead code
    const startY = this._resPosY ?? 0;

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
      fontSize: '17px', fontFamily: 'monospace', color: '#8866ff', fontStyle: 'bold',
    }));
    container.add(this.add.text(panelW - pad, 14, '[R] close', {
      fontSize: '12px', fontFamily: 'monospace', color: '#443366',
    }).setOrigin(1, 0));

    // Tier column labels
    const tierLabels = ['I', 'II', 'III', 'IV', 'V'];
    const tierColors = [0x44aa66, 0xaa8844, 0xaa44aa, 0xcc4444, 0x4488cc];
    for (let c = 0; c <= maxCol; c++) {
      const cx = pad + c * (cardSize + gapX) + cardSize / 2;
      container.add(this.add.text(cx, titleBarH + 6, `Tier ${tierLabels[c] || c+1}`, {
        fontSize: '12px', fontFamily: 'monospace',
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
      card.fillRect(cx + 4, cy + 4, cardSize - 8, 4);

      container.add(card);

      // Name
      container.add(this.add.text(cx + cardSize / 2, cy + 14, node.name, {
        fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold',
        color: isLocked ? '#333344' : (isCompleted ? '#55cc66' : '#ccccdd'),
      }).setOrigin(0.5, 0));

      // Description
      container.add(this.add.text(cx + cardSize / 2, cy + 32, node.desc, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#222233' : '#889999',
        wordWrap: { width: cardSize - 16 },
        align: 'center',
      }).setOrigin(0.5, 0));

      // Cost
      const costLines = Object.entries(node.cost).map(([k, v]) => {
        const have = this.inventory[k] || 0;
        return `${k}: ${have}/${v}`;
      }).join('  ');
      container.add(this.add.text(cx + cardSize / 2, cy + 68, costLines, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : (canAfford ? '#66aa77' : '#884444'),
        align: 'center',
      }).setOrigin(0.5, 0));

      // Time
      container.add(this.add.text(cx + cardSize / 2, cy + 86, `${node.time}s`, {
        fontSize: '11px', fontFamily: 'monospace',
        color: isLocked ? '#1a1a22' : '#556666',
      }).setOrigin(0.5, 0));

      // Status / Progress
      if (isCompleted) {
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 22, 'COMPLETE', {
          fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold', color: '#33aa44',
        }).setOrigin(0.5, 0));
      } else if (isActive) {
        const pct = state.progress / node.time;
        const bar = this.add.graphics();
        bar.fillStyle(0x222233, 1);
        bar.fillRoundedRect(cx + 8, cy + cardSize - 24, cardSize - 16, 14, 3);
        bar.fillStyle(0x8866ff, 1);
        bar.fillRoundedRect(cx + 8, cy + cardSize - 24, (cardSize - 16) * pct, 14, 3);
        container.add(bar);
        const pctText = this.add.text(cx + cardSize / 2, cy + cardSize - 23, `${((pct)*100).toFixed(0)}%`, {
          fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
        }).setOrigin(0.5, 0);
        container.add(pctText);
        // Store refs for live update
        this._resBar = bar;
        this._resPctText = pctText;
        this._resBarX = cx + 8;
        this._resBarY = cy + cardSize - 24;
        this._resBarW = cardSize - 16;
        this._resNodeTime = node.time;
      } else if (canStart) {
        const btnW = 80;
        const btnH = 22;
        const btnX = cx + (cardSize - btnW) / 2;
        const btnY = cy + cardSize - btnH - 6;
        const btn = this.add.graphics();
        btn.fillStyle(0x44aa44, 0.9);
        btn.fillRoundedRect(btnX, btnY, btnW, btnH, 4);
        container.add(btn);
        container.add(this.add.text(cx + cardSize / 2, btnY + 3, 'START', {
          fontSize: '12px', fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold',
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
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 20, 'LOCKED', {
          fontSize: '11px', fontFamily: 'monospace', color: '#333344',
        }).setOrigin(0.5, 0));
      } else {
        container.add(this.add.text(cx + cardSize / 2, cy + cardSize - 20, 'NEED RES', {
          fontSize: '11px', fontFamily: 'monospace', color: '#553333',
        }).setOrigin(0.5, 0));
      }

      // Cancel for active
      if (isActive) {
        const cbtn = this.add.graphics();
        cbtn.fillStyle(0x663333, 0.8);
        cbtn.fillRoundedRect(cx + cardSize - 20, cy + 4, 16, 16, 3);
        container.add(cbtn);
        container.add(this.add.text(cx + cardSize - 12, cy + 5, 'X', {
          fontSize: '11px', fontFamily: 'monospace', color: '#ff8888', fontStyle: 'bold',
        }).setOrigin(0.5, 0));

        const cancelZone = this.add.rectangle(
          startX + cx + cardSize - 12, startY + cy + 12, 16, 16, 0x000000, 0
        ).setInteractive({ useHandCursor: true }).setDepth(3205);
        this.researchElements.push(cancelZone);
        cancelZone.on('pointerdown', () => {
          const gs = this.scene.get('GameScene');
          if (gs?.socket) gs.socket.send({ type: 'research_cancel' });
        });
      }
    }
  }

  updateResearchProgress() {
    if (!this.researchOpen || !this.researchState?.active) return;
    // Full redraw to update progress bar (throttled to every 500ms)
    const now = Date.now();
    if (!this._resLastRedraw || now - this._resLastRedraw > 500) {
      this._resLastRedraw = now;
      this.showResearch();
    }
  }

  isPointInResearch(screenX, screenY) {
    return this.researchOpen; // full-screen overlay blocks everything
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
