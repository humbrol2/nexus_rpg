import Phaser from 'phaser';
import { GameSocket } from '../network/Socket.js';
import { HUDScene } from './HUDScene.js';
import { generateTileset, getTileIndex, generatePlayerTextures, TILE_SIZE } from '../TilesetGenerator.js';

const TILE_PX = TILE_SIZE;

const TILE_LABELS = {
  0: 'Deep Water', 1: 'Water', 2: 'Sand', 3: 'Dirt',
  4: 'Alien Grass', 5: 'Rock', 6: 'Dense Rock',
  7: 'Iron Ore', 8: 'Copper Ore', 9: 'Alien Flora',
  10: 'Crystal', 11: 'Alien Tree', 100: 'Wall', 101: 'Floor',
  200: 'Auto-Miner', 201: 'Fabricator', 202: 'Storage Crate', 203: 'Furnace',
};

// Item key -> build/place action (used when toolbar slot is active and you click the world)
const ITEM_ACTIONS = {
  _build_wall:    { type: 'build', item: 'wall' },
  _build_floor:   { type: 'build', item: 'floor' },
  _build_miner:   { type: 'machine', machine_type: 200 },
  _build_furnace: { type: 'machine', machine_type: 203 },
  _build_fab:     { type: 'machine', machine_type: 201 },
  _build_storage: { type: 'machine', machine_type: 202 },
};

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.socket = null;
    this.myId = null;
    this.myPlayer = null;
    this.otherPlayers = {};
    this.chunkSize = 64;
    this.loadedChunks = {};
    this.chunkTileData = {};
    this.lastChunkX = null;
    this.lastChunkY = null;
    this.keys = null;
    this.speed = 200;
    this.chunkLoadRadius = 2;
    this.nameTexts = {};
    this.inventory = {};
    this.isMining = false;
    this.mineTarget = null;
    this.mineProgress = 0;
    this.mineDuration = 0;
    this.machineIcons = {};
    this.cursorWX = 0;
    this.cursorWY = 0;
  }

  get hud() {
    return this.scene.get('HUDScene');
  }

  preload() {
    // Generate procedural tileset and player textures
    generateTileset(this);
    generatePlayerTextures(this);
  }

  create() {
    // Register and launch HUD scene on top
    this.scene.add('HUDScene', HUDScene, true);

    // Input
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // Number keys 1-9, 0 select toolbar slots
    const numKeys = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','ZERO'];
    numKeys.forEach((keyName, i) => {
      this.input.keyboard.on(`keydown-${keyName}`, () => {
        if (this.hud?.machineUIOpen || this.hud?.worldMapOpen) return;
        this.hud.selectToolbarSlot(i);
      });
    });
    this.input.keyboard.on('keydown-ESC', () => this._cancelAll());
    this.input.keyboard.on('keydown-E', () => this._interactAtCursor());
    this.input.keyboard.on('keydown-I', () => this.hud.toggleInventory());
    this.input.keyboard.on('keydown-C', () => this.hud.toggleCrafting());
    this.input.keyboard.on('keydown-R', () => this.hud.toggleResearch());
    this.input.keyboard.on('keydown-M', () => this.hud.toggleWorldMap());
    this.input.keyboard.on('keydown-TAB', (e) => {
      e.preventDefault();
      this.hud.toggleWorldMap();
    });
    this.input.keyboard.on('keydown-G', () => this._withdrawFromMachine()); // G for grab
    this.input.keyboard.on('keydown-Q', () => this.hud.closeMachineUI());

    // Backtick to open chat
    this.input.keyboard.on('keydown', (e) => {
      if (e.key === '`' || e.key === 'Dead') {
        if (!this.hud.chatOpen) {
          e.preventDefault();
          this.hud.openChat();
        }
      }
    });

    this.input.on('pointerdown', (pointer) => this._onPointerDown(pointer));
    this.input.on('pointermove', (pointer) => this._onPointerMove(pointer));

    // Mousewheel zoom
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, 0.25, 3));
    });

    // Mining progress graphics (world space — these zoom with the world, which is correct)
    this.mineProgressBg = this.add.graphics().setDepth(200);
    this.mineProgressBar = this.add.graphics().setDepth(201);

    // Build preview
    this.buildPreview = this.add.graphics().setDepth(150);

    // Connect
    this.socket = new GameSocket();
    this._setupSocketHandlers();
    this.socket.connect();
  }

  _cancelAll() {
    if (this.hud.researchOpen) {
      this.hud.closeResearch();
      return;
    }
    if (this.hud.worldMapOpen) {
      this.hud.closeWorldMap();
      return;
    }
    if (this.hud.craftingOpen) {
      this.hud.closeCrafting();
      return;
    }
    if (this.hud.inventoryOpen) {
      this.hud.closeInventory();
      return;
    }
    if (this.hud.machineUIOpen) {
      this.hud.closeMachineUI();
      return;
    }
    if (this.isMining) {
      this.isMining = false;
      this.mineTarget = null;
      this.mineProgressBg.clear();
      this.mineProgressBar.clear();
      this.socket.send({ type: 'mine_cancel' });
    }
    // Deselect toolbar
    this.hud.activeToolbarSlot = -1;
    this.hud._renderToolbar();
    this.buildPreview.clear();
  }

  // ── Tile helpers ──

  _worldToTile(worldX, worldY) {
    return { wx: Math.floor(worldX / TILE_PX), wy: Math.floor(worldY / TILE_PX) };
  }

  _getTileAt(wx, wy) {
    const cx = Math.floor(wx / this.chunkSize);
    const cy = Math.floor(wy / this.chunkSize);
    const data = this.chunkTileData[`${cx},${cy}`];
    if (!data) return -1;
    const lx = ((wx % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const ly = ((wy % this.chunkSize) + this.chunkSize) % this.chunkSize;
    return data[ly * this.chunkSize + lx];
  }

  _isSolidTile(tileId) {
    return tileId === 0 || tileId === 1 || tileId === 6 || tileId === 11 || tileId === 100 || tileId >= 200;
  }

  _checkCollision(x, y) {
    const half = 10;
    for (const [ox, oy] of [[-half,-half],[half,-half],[-half,half],[half,half]]) {
      const tile = this._getTileAt(Math.floor((x+ox)/TILE_PX), Math.floor((y+oy)/TILE_PX));
      if (tile >= 0 && this._isSolidTile(tile)) return true;
    }
    return false;
  }

  // ── Mouse ──

  _onPointerDown(pointer) {
    if (!this.myPlayer) return;
    if (this.hud?.machineUIOpen) return;
    // Allow game interaction outside UI panels
    if (this.hud?.isPointInInventory(pointer.x, pointer.y)) return;
    if (this.hud?.isPointInCrafting(pointer.x, pointer.y)) return;
    if (this.hud?.isPointInResearch(pointer.x, pointer.y)) return;
    if (this.hud?.isPointInToolbar(pointer.x, pointer.y)) return;

    const { wx, wy } = this._worldToTile(pointer.worldX, pointer.worldY);

    // Check if active toolbar slot has a build action
    const activeItem = this.hud?.getActiveToolbarItem();
    const action = activeItem ? ITEM_ACTIONS[activeItem] : null;
    if (action) {
      if (action.type === 'build') {
        this.socket.send({ type: 'build', item: action.item, wx, wy });
      } else if (action.type === 'machine') {
        this.socket.send({ type: 'place_machine', machine_type: action.machine_type, wx, wy });
      }
      return;
    }

    if (pointer.rightButtonDown()) {
      const tile = this._getTileAt(wx, wy);
      if (tile >= 200) {
        this.socket.send({ type: 'interact_machine', wx, wy });
      }
      return;
    }

    const tile = this._getTileAt(wx, wy);
    if (tile < 0) return;
    if ([5, 6, 7, 8, 9, 10, 11, 100].includes(tile)) {
      this.socket.send({ type: 'mine_start', wx, wy });
    }
  }

  _onPointerMove(pointer) {
    if (!this.myPlayer) return;
    const { wx, wy } = this._worldToTile(pointer.worldX, pointer.worldY);
    this.cursorWX = wx;
    this.cursorWY = wy;

    const tile = this._getTileAt(wx, wy);
    this.hud.updateTileInfo(`[${wx}, ${wy}] ${TILE_LABELS[tile] || '???'}`);

    this.buildPreview.clear();
    const activeItem = this.hud?.getActiveToolbarItem();
    const hasAction = activeItem && ITEM_ACTIONS[activeItem];
    if (hasAction) {
      this.buildPreview.fillStyle(0xffaa00, 0.25);
      this.buildPreview.fillRect(wx * TILE_PX, wy * TILE_PX, TILE_PX, TILE_PX);
      this.buildPreview.lineStyle(2, 0xffaa00, 0.8);
      this.buildPreview.strokeRect(wx * TILE_PX, wy * TILE_PX, TILE_PX, TILE_PX);
    }
  }

  // ── Machine interaction ──

  _interactAtCursor() {
    if (!this.myPlayer) return;
    const tile = this._getTileAt(this.cursorWX, this.cursorWY);
    if (tile >= 200) {
      this.socket.send({ type: 'interact_machine', wx: this.cursorWX, wy: this.cursorWY });
    }
  }

  _withdrawFromMachine() {
    const hud = this.hud;
    if (hud.machineUIOpen && hud.machineUIData) {
      this.socket.send({
        type: 'machine_withdraw',
        wx: hud.machineUIData.wx, wy: hud.machineUIData.wy,
      });
    }
  }

  _depositToMachine(item, count = 1) {
    const hud = this.hud;
    if (hud.machineUIOpen && hud.machineUIData) {
      this.socket.send({
        type: 'machine_deposit',
        wx: hud.machineUIData.wx, wy: hud.machineUIData.wy,
        item, count,
      });
    }
  }

  // ── Machine icons on map ──

  _addMachineIcon(machine) {
    const key = `${machine.wx},${machine.wy}`;
    if (this.machineIcons[key]) return;
    const symbols = { 200: 'M', 201: 'F', 202: 'S', 203: 'Fu' };
    const icon = this.add.text(
      machine.wx * TILE_PX + TILE_PX / 2,
      machine.wy * TILE_PX + TILE_PX / 2,
      symbols[machine.machine_type] || '?', {
        fontSize: '14px', fontFamily: 'monospace',
        color: '#ffffff', fontStyle: 'bold',
      }
    ).setOrigin(0.5).setDepth(50);
    this.machineIcons[key] = icon;
  }

  _removeMachineIcon(wx, wy) {
    const key = `${wx},${wy}`;
    if (this.machineIcons[key]) {
      this.machineIcons[key].destroy();
      delete this.machineIcons[key];
    }
  }

  // ── Socket ──

  _setupSocketHandlers() {
    const hud = this.hud;

    this.socket.on('init', (msg) => {
      this.myId = msg.player.id;
      this.chunkSize = msg.chunkSize;
      this.inventory = msg.inventory || {};
      this.recipes = msg.recipes || {};

      // Load research tree
      hud.researchTree = msg.researchTree || {};
      hud.researchState = msg.research || { completed: [], active: null, progress: 0 };

      // Update admin status from server (authoritative)
      if (msg.is_admin) {
        localStorage.setItem('sc_is_admin', '1');
        const adminBtn = document.getElementById('btn-admin');
        if (adminBtn) adminBtn.style.display = 'block';
      }

      this.myPlayer = this.add.sprite(msg.player.x, msg.player.y, 'player_self').setDepth(100);
      this.myNameTag = this.add.text(msg.player.x, msg.player.y - 20, msg.player.name, {
        fontSize: '10px', fontFamily: 'monospace', color: '#00ff88',
      }).setOrigin(0.5).setDepth(102);
      this.cameras.main.startFollow(this.myPlayer, true, 0.1, 0.1);
      this.game.canvas.oncontextmenu = (e) => e.preventDefault();

      hud.setStatus('Connected');
      this.time.delayedCall(2000, () => hud.hideStatus());
      hud.updateInventory(this.inventory);

      // Recipe keys (F1-F5) when machine UI is open
      const recipeNames = Object.keys(this.recipes);
      recipeNames.forEach((name, i) => {
        if (i > 8) return;
        this.input.keyboard.on(`keydown-F${i + 1}`, () => {
          if (hud.machineUIOpen && hud.machineUIData) {
            this.socket.send({
              type: 'machine_set_recipe',
              wx: hud.machineUIData.wx, wy: hud.machineUIData.wy,
              recipe: name,
            });
          }
        });
      });

      // Deposit keys (7-0)
      const depositItems = ['iron_ore', 'copper_ore', 'stone', 'iron_plate', 'copper_plate'];
      ['SEVEN', 'EIGHT', 'NINE', 'ZERO'].forEach((keyName, i) => {
        this.input.keyboard.on(`keydown-${keyName}`, () => {
          if (hud.machineUIOpen && hud.machineUIData && depositItems[i]) {
            this._depositToMachine(depositItems[i], 5);
          }
        });
      });
    });

    this.socket.on('chunk', (msg) => {
      this._renderChunk(msg.cx, msg.cy, msg.tiles, msg.size);
      this.chunkTileData[`${msg.cx},${msg.cy}`] = msg.tiles;
      // Feed to minimap
      this.hud.registerChunk(msg.cx, msg.cy, msg.tiles, msg.size);
    });

    this.socket.on('tile_update', (msg) => this._updateTile(msg.wx, msg.wy, msg.tile));

    this.socket.on('inventory', (msg) => {
      this.inventory = msg.inventory;
      hud.updateInventory(this.inventory);
    });

    this.socket.on('mine_progress', (msg) => {
      this.isMining = true;
      this.mineTarget = { wx: msg.wx, wy: msg.wy, hp: msg.hp, maxHp: msg.max_hp };
      this.mineProgress = 0;
      this.mineDuration = msg.duration * 1000;
    });

    this.socket.on('mine_success', (msg) => {
      this.isMining = false;
      this.mineProgressBg.clear();
      this.mineProgressBar.clear();
      const hpInfo = this.mineTarget?.hp ? ` (${this.mineTarget.hp - 1} left)` : '';
      hud.showToast(`+${msg.count} ${msg.item}${hpInfo}`);
    });

    this.socket.on('mine_fail', () => {
      this.isMining = false;
      this.mineProgressBg.clear();
      this.mineProgressBar.clear();
    });

    this.socket.on('ore_hp', (msg) => {
      // Could show floating HP text or darken the tile — for now just log
    });

    // Research
    this.socket.on('research_update', (msg) => {
      hud.researchState = msg.research;
      if (hud.researchOpen) hud.showResearch();
    });
    this.socket.on('research_complete', (msg) => {
      hud.researchState = msg.research;
      hud.showToast(`Research complete: ${hud.researchTree[msg.id]?.name || msg.id}`);
      if (hud.researchOpen) hud.showResearch();
    });
    this.socket.on('research_fail', (msg) => {
      hud.showToast(`Research failed: ${msg.reason}`);
    });

    // Chat
    this.socket.on('chat', (msg) => {
      hud.addChatMessage(msg.name, msg.text);
    });

    this.socket.on('build_success', (msg) => hud.showToast(`Built ${msg.item}`));

    this.socket.on('build_fail', (msg) => {
      const reasons = {
        no_resources: 'Not enough resources', blocked: 'Can\'t build here',
        unknown_item: 'Unknown item', unknown_machine: 'Unknown machine', occupied: 'Already occupied',
      };
      hud.showToast(reasons[msg.reason] || 'Build failed');
    });

    this.socket.on('position_correct', (msg) => {
      if (this.myPlayer) { this.myPlayer.x = msg.x; this.myPlayer.y = msg.y; }
    });

    this.socket.on('machine_state', (msg) => {
      this._addMachineIcon(msg.machine);
      if (hud.machineUIOpen && hud.machineUIData &&
          hud.machineUIData.wx === msg.machine.wx && hud.machineUIData.wy === msg.machine.wy) {
        hud.showMachineUI(msg.machine);
      }
    });

    this.socket.on('machine_ui', (msg) => hud.showMachineUI(msg.machine));

    this.socket.on('machine_removed', (msg) => {
      this._removeMachineIcon(msg.wx, msg.wy);
      if (hud.machineUIOpen && hud.machineUIData &&
          hud.machineUIData.wx === msg.wx && hud.machineUIData.wy === msg.wy) {
        hud.closeMachineUI();
      }
    });

    // Store target positions, interpolate in update()
    this._otherTargets = {}; // id -> {tx, ty}

    this.socket.on('state', (msg) => {
      const seen = new Set();
      for (const p of msg.players) {
        if (p.id === this.myId) continue;
        seen.add(p.id);
        if (!this.otherPlayers[p.id]) {
          this.otherPlayers[p.id] = this.add.sprite(p.x, p.y, 'player_other').setDepth(99);
          this.nameTexts[p.id] = this.add.text(p.x, p.y - 20, p.name || p.id.slice(0, 6), {
            fontSize: '10px', fontFamily: 'monospace', color: '#88bbff',
          }).setOrigin(0.5).setDepth(101);
        }
        // Set target — interpolation happens in update()
        this._otherTargets[p.id] = { tx: p.x, ty: p.y };
      }
      for (const id of Object.keys(this.otherPlayers)) {
        if (!seen.has(id)) {
          this.otherPlayers[id].destroy(); delete this.otherPlayers[id];
          if (this.nameTexts[id]) { this.nameTexts[id].destroy(); delete this.nameTexts[id]; }
          delete this._otherTargets[id];
        }
      }
    });

    this.socket.on('player_leave', (msg) => {
      if (this.otherPlayers[msg.id]) { this.otherPlayers[msg.id].destroy(); delete this.otherPlayers[msg.id]; }
      if (this.nameTexts[msg.id]) { this.nameTexts[msg.id].destroy(); delete this.nameTexts[msg.id]; }
    });
  }

  // ── Rendering ──

  _renderChunk(cx, cy, tiles, size) {
    const key = `${cx},${cy}`;
    if (this.loadedChunks[key]) this.loadedChunks[key].destroy();

    const offsetX = cx * size * TILE_PX;
    const offsetY = cy * size * TILE_PX;
    const pixW = size * TILE_PX;
    const pixH = size * TILE_PX;

    // Draw chunk to a canvas, then create a texture + sprite
    const canvasKey = `chunk_${cx}_${cy}`;
    if (this.textures.exists(canvasKey)) this.textures.remove(canvasKey);

    const canvasTex = this.textures.createCanvas(canvasKey, pixW, pixH);
    const ctx = canvasTex.context;
    const tilesetCanvas = this.textures.get('tileset').getSourceImage();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tileId = tiles[y * size + x];
        const idx = getTileIndex(tileId);
        ctx.drawImage(
          tilesetCanvas,
          idx * TILE_PX, 0, TILE_PX, TILE_PX,
          x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX
        );
      }
    }
    canvasTex.refresh();

    const sprite = this.add.sprite(offsetX, offsetY, canvasKey).setOrigin(0, 0).setDepth(0);
    this.loadedChunks[key] = sprite;
    this._unloadDistantChunks();
  }

  _updateTile(wx, wy, tileId) {
    const cx = Math.floor(wx / this.chunkSize);
    const cy = Math.floor(wy / this.chunkSize);
    const key = `${cx},${cy}`;
    const data = this.chunkTileData[key];
    if (data) {
      const lx = ((wx % this.chunkSize) + this.chunkSize) % this.chunkSize;
      const ly = ((wy % this.chunkSize) + this.chunkSize) % this.chunkSize;
      data[ly * this.chunkSize + lx] = tileId;
    }

    // Re-render the chunk with updated tile data
    if (data) {
      this._renderChunk(cx, cy, data, this.chunkSize);
    }

    if (tileId < 200) this._removeMachineIcon(wx, wy);
  }

  _unloadDistantChunks() {
    if (!this.myPlayer) return;
    const pcx = Math.floor(this.myPlayer.x / (this.chunkSize * TILE_PX));
    const pcy = Math.floor(this.myPlayer.y / (this.chunkSize * TILE_PX));
    const max = this.chunkLoadRadius + 2;
    for (const key of Object.keys(this.loadedChunks)) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > max || Math.abs(cy - pcy) > max) {
        this.loadedChunks[key].destroy();
        // Clean up the canvas texture too
        const canvasKey = `chunk_${cx}_${cy}`;
        if (this.textures.exists(canvasKey)) this.textures.remove(canvasKey);
        delete this.loadedChunks[key];
        delete this.chunkTileData[key];
      }
    }
  }

  // ── Game loop ──

  update(time, delta) {
    if (!this.myPlayer || !this.socket.connected) return;
    if (this.hud?.worldMapOpen) {
      this.hud.updateWorldMap();
      return;
    }
    const dt = delta / 1000;

    // Mining
    if (this.isMining && this.mineTarget) {
      this.mineProgress += delta;
      const pct = Math.min(this.mineProgress / this.mineDuration, 1);
      const barX = this.mineTarget.wx * TILE_PX;
      const barY = this.mineTarget.wy * TILE_PX - 8;

      this.mineProgressBg.clear();
      this.mineProgressBar.clear();

      // Mining progress bar (green)
      this.mineProgressBg.fillStyle(0x000000, 0.7);
      this.mineProgressBg.fillRect(barX, barY, TILE_PX, 5);
      this.mineProgressBar.fillStyle(0x00ff88, 1);
      this.mineProgressBar.fillRect(barX, barY, TILE_PX * pct, 5);

      // Ore HP bar (orange, below mining bar)
      if (this.mineTarget.maxHp && this.mineTarget.maxHp > 1) {
        const hpPct = (this.mineTarget.hp || 0) / this.mineTarget.maxHp;
        const hpBarY = barY + 7;
        this.mineProgressBg.fillStyle(0x000000, 0.5);
        this.mineProgressBg.fillRect(barX, hpBarY, TILE_PX, 3);
        this.mineProgressBar.fillStyle(0xffaa00, 1);
        this.mineProgressBar.fillRect(barX, hpBarY, TILE_PX * hpPct, 3);
      }

      if (pct >= 1) {
        this.socket.send({ type: 'mine_complete' });
        this.isMining = false;
        this.mineProgressBg.clear();
        this.mineProgressBar.clear();
      }
    }

    // Smooth interpolation of other players (every frame, not just on state updates)
    if (this._otherTargets) {
      for (const [id, target] of Object.entries(this._otherTargets)) {
        const sprite = this.otherPlayers[id];
        if (!sprite) continue;
        // Lerp at ~0.15 per frame (~60fps) for smooth movement
        sprite.x = Phaser.Math.Linear(sprite.x, target.tx, 0.15);
        sprite.y = Phaser.Math.Linear(sprite.y, target.ty, 0.15);
        if (this.nameTexts[id]) this.nameTexts[id].setPosition(sprite.x, sprite.y - 20);
      }
    }

    // Block movement when chat is open
    if (this.hud?.chatOpen) return;

    // Movement
    let dx = 0, dy = 0;
    if (this.keys.left.isDown) dx -= 1;
    if (this.keys.right.isDown) dx += 1;
    if (this.keys.up.isDown) dy -= 1;
    if (this.keys.down.isDown) dy += 1;
    if (dx !== 0 && dy !== 0) { dx /= Math.sqrt(2); dy /= Math.sqrt(2); }

    if (dx !== 0 || dy !== 0) {
      if (this.isMining) this._cancelAll();

      const newX = this.myPlayer.x + dx * this.speed * dt;
      const newY = this.myPlayer.y + dy * this.speed * dt;
      let finalX = this.myPlayer.x, finalY = this.myPlayer.y;
      if (!this._checkCollision(newX, this.myPlayer.y)) finalX = newX;
      if (!this._checkCollision(finalX, newY)) finalY = newY;

      if (finalX !== this.myPlayer.x || finalY !== this.myPlayer.y) {
        this.myPlayer.x = finalX;
        this.myPlayer.y = finalY;
        if (this.myNameTag) this.myNameTag.setPosition(finalX, finalY - 20);
        const newCX = Math.floor(finalX / (this.chunkSize * TILE_PX));
        const newCY = Math.floor(finalY / (this.chunkSize * TILE_PX));
        const cc = (newCX !== this.lastChunkX || newCY !== this.lastChunkY);
        if (cc) { this.lastChunkX = newCX; this.lastChunkY = newCY; }
        this.socket.send({ type: 'move', x: finalX, y: finalY, chunk_changed: cc });
      }
    }

    // Update HUD coords
    const tx = Math.floor(this.myPlayer.x / TILE_PX);
    const ty = Math.floor(this.myPlayer.y / TILE_PX);
    const cx = Math.floor(this.myPlayer.x / (this.chunkSize * TILE_PX));
    const cy = Math.floor(this.myPlayer.y / (this.chunkSize * TILE_PX));
    this.hud.updateCoords(
      `Pos: ${tx}, ${ty} | Chunk: ${cx}, ${cy} | Players: ${Object.keys(this.otherPlayers).length + 1}`
    );

    // Update minimap with player positions
    const others = Object.values(this.otherPlayers).map(s => ({ x: s.x, y: s.y }));
    this.hud.updateMinimapEntities(this.myPlayer.x, this.myPlayer.y, this.chunkSize, others, []);

    // Chat fade
    this.hud.updateChat();
  }
}
