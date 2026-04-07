# SpaceColony

Multiplayer 2D colony sim — build, mine, farm, and explore an alien planet.

**Live**: https://rpg.humbrol2.com

## Stack

- **Server**: Python (FastAPI + WebSocket)
- **Client**: Phaser 3 + Vite
- **Database**: PostgreSQL + Redis
- **Auth**: JWT + bcrypt

## Features

- Procedural alien world with biomes (grass, rock, sand, water, forests)
- Underground cave system (Z-levels, craftable stairs)
- Mining with ore HP, respawning resources
- Crafting (hand recipes + machine recipes)
- Machines: auto-miner, fabricator, furnace, storage crates, chests
- Farming: plant wheat seeds, real-time growth (offline OK), harvest
- Research tree unlocking buildings, machines, farming, underground access
- Land claims (25x25 protected zones)
- Signs with custom text
- Multiplayer: see other players, chat, spatial culling
- Health system with death/respawn
- Character sheet (K key)
- Procedural pixel-art tileset (no sprite assets)
- Admin tools (kick, ban, chat log)

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| I | Inventory |
| C | Crafting |
| R | Research |
| K | Character sheet |
| H | Help |
| M / Tab | World map |
| Scroll | Zoom |
| Left click | Mine / place / interact |
| Right click | Pick up building |
| ` (backtick) | Chat |

## Running locally

```bash
# Server
cd server
pip install -r requirements.txt
cp .env.example .env  # configure DB connection
python main.py

# Client
cd client
npm install
npx vite dev
```

## Project Structure

```
server/
  main.py           # WebSocket server, game loop, message handlers
  item_registry.py  # Tiles, items, recipes, crafting menu (single source of truth)
  world.py          # Procedural terrain generation, chunk system
  player.py         # Player state, HP, inventory
  machines.py       # Machine types and processing
  research.py       # Tech tree
  database.py       # PostgreSQL + Redis CRUD
  npcs.py           # NPC animals

client/src/
  scenes/
    GameScene.js    # World rendering, input, networking
    HUDScene.js     # All UI panels (inventory, crafting, research, chat, etc.)
  TilesetGenerator.js  # Procedural pixel-art tile painters
  network/Socket.js    # WebSocket wrapper with auth
```
