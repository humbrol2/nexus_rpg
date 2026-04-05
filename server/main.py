"""SpaceColony game server — FastAPI + WebSocket with auth + persistence."""

import asyncio
import json
import os
import re
import uuid
import time
import secrets
from contextlib import asynccontextmanager

import bcrypt
import jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from world import WorldGenerator, CHUNK_SIZE, SOLID_TILES, DIRT, WALL, FLOOR, RESPAWN_TIMES
SIGN = 102
from item_registry import (
    TILES, ITEMS, MINABLE, BUILDABLE, HAND_RECIPES, MACHINES,
    MACHINE_RECIPES, CRAFTING_MENU, ANIMALS, get_client_registry,
    get_zone_at, set_active_claims, SPAWN_X, SPAWN_Y,
)
from player import PlayerManager, Player
from machines import (
    MachineManager, Machine, MACHINE_COSTS, MACHINE_MINER, MACHINE_FABRICATOR,
    MACHINE_STORAGE, MACHINE_FURNACE, RECIPES, MACHINE_NAMES,
)
import database as db
from research import PlayerResearch, RESEARCH_TREE, get_tree_for_client
from npcs import NPCManager, ANIMAL_TYPES

TILE_PX = 32
UPS = 10
TICK_INTERVAL = 1.0 / UPS
CHUNK_LOAD_RADIUS = 2
SAVE_INTERVAL = 30  # auto-save every 30 seconds

# JWT secret — generated once per server run. For production, use env var.
# Persist JWT secret so tokens survive server restarts
_jwt_path = os.path.join(os.path.dirname(__file__), ".jwt_secret")
if os.path.exists(_jwt_path):
    with open(_jwt_path) as f:
        JWT_SECRET = f.read().strip()
else:
    JWT_SECRET = secrets.token_hex(32)
    with open(_jwt_path, "w") as f:
        f.write(JWT_SECRET)
JWT_ALGORITHM = "HS256"

world = WorldGenerator(seed=12345)
players = PlayerManager()
machine_mgr = MachineManager()
npc_mgr = NPCManager()
connections: dict[str, WebSocket] = {}
mining_sessions: dict[str, dict] = {}
# Map ws_id -> user_id for persistence
ws_to_user: dict[str, int] = {}
# Research state per ws_id
player_research: dict[str, PlayerResearch] = {}
# Track who placed each building: (wx, wy) -> user_id
building_owners: dict[tuple[int, int], int] = {}


def check_zone_permission(wx: int, wy: int, user_id: int, is_admin: bool) -> str | None:
    """Check if building/mining is allowed at this position. Returns error reason or None."""
    zone = get_zone_at(wx, wy)
    if zone["admin_only"] and not is_admin:
        return "protected_zone"
    if zone.get("claimed") and zone.get("owner_id") != user_id and not is_admin:
        return "claimed_land"
    return None


def load_world_state():
    """Load persisted world modifications and machines on startup."""
    # Load tile modifications
    mods = db.load_world_mods()
    world._modifications = mods
    print(f"[INIT] Loaded {len(mods)} tile modifications")

    # Load building ownership
    global building_owners
    building_owners = db.load_building_owners()
    print(f"[INIT] Loaded {len(building_owners)} building owners")

    # Rebuild respawn queue for mined tiles that should regrow
    # Any DIRT modification where the original procedural tile was a respawnable resource
    import time as _time
    respawn_count = 0
    for (wx, wy), tile_id in list(world._modifications.items()):
        if tile_id == DIRT:
            original = world._get_tile(wx, wy)
            if original in RESPAWN_TIMES and RESPAWN_TIMES[original] > 0:
                # Queue respawn — assume it was mined recently (conservative: full respawn time)
                world._respawn_queue[(wx, wy)] = (original, _time.time() + RESPAWN_TIMES[original])
                respawn_count += 1
    print(f"[INIT] Queued {respawn_count} tile respawns")

    # Load land claims
    claims = db.get_all_claims()
    set_active_claims(claims)
    print(f"[INIT] Loaded {len(claims)} land claims")

    # Load machines
    machine_data = db.load_machines()
    for md in machine_data:
        m = Machine(
            machine_id=md["machine_id"],
            machine_type=md["machine_type"],
            wx=md["wx"], wy=md["wy"],
            owner_id=str(md["owner_id"]),
            inventory=md["inventory"],
            output=md["output"],
            recipe=md["recipe"],
        )
        machine_mgr._machines[m.machine_id] = m
        machine_mgr._by_pos[(m.wx, m.wy)] = m.machine_id
        # Update next_id counter
        try:
            num = int(m.machine_id.split("_")[1])
            if num >= machine_mgr._next_id:
                machine_mgr._next_id = num + 1
        except (IndexError, ValueError):
            pass
    print(f"[INIT] Loaded {len(machine_data)} machines")


def save_world_state():
    """Persist all world modifications and machines."""
    # Save tile modifications
    for (wx, wy), tile_id in world._modifications.items():
        db.save_world_mod(wx, wy, tile_id)

    # Save machines
    db.save_all_machines(machine_mgr.get_all())


def save_player(ws_id: str, player: Player):
    """Save a single player's state."""
    user_id = ws_to_user.get(ws_id)
    if user_id:
        db.save_player_state(user_id, player.x, player.y, player.inventory)


async def send_json(ws: WebSocket, data: dict) -> None:
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def broadcast_json(data: dict) -> None:
    msg = json.dumps(data)
    for ws in list(connections.values()):
        try:
            await ws.send_text(msg)
        except Exception:
            pass


async def send_chunks_around(ws: WebSocket, player: Player) -> None:
    cx, cy = player.chunk_x, player.chunk_y
    for dx in range(-CHUNK_LOAD_RADIUS, CHUNK_LOAD_RADIUS + 1):
        for dy in range(-CHUNK_LOAD_RADIUS, CHUNK_LOAD_RADIUS + 1):
            chunk = world.get_chunk(cx + dx, cy + dy)
            await send_json(ws, {
                "type": "chunk",
                "cx": chunk.cx, "cy": chunk.cy,
                "tiles": chunk.to_flat(), "size": CHUNK_SIZE,
            })
            for m in machine_mgr.get_in_chunk(cx + dx, cy + dy):
                await send_json(ws, {"type": "machine_state", "machine": m.to_dict()})
            # Send signs in this chunk
            for sign in db.get_signs_in_chunk(cx + dx, cy + dy):
                await send_json(ws, {"type": "sign_data", "sign": sign})
            # Spawn NPCs in this chunk if not yet spawned
            npc_mgr.spawn_in_chunk(cx + dx, cy + dy, world)


@asynccontextmanager
async def lifespan(app):
    db.init_db()
    load_world_state()
    loop_task = asyncio.create_task(game_loop())
    save_task = asyncio.create_task(auto_save_loop())
    yield
    loop_task.cancel()
    save_task.cancel()
    save_world_state()
    print("[SHUTDOWN] World state saved")


app = FastAPI(title="SpaceColony Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth Models ──

class AuthRequest(BaseModel):
    username: str
    password: str


# ── Auth Endpoints ──

@app.post("/register")
async def register(req: AuthRequest):
    if len(req.username) < 3 or len(req.username) > 20:
        raise HTTPException(400, "Username must be 3-20 characters")
    if len(req.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    password_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
    user_id = db.create_user(req.username, password_hash)
    if user_id is None:
        raise HTTPException(409, "Username already taken")

    # Only "humbrol2" gets auto-admin
    if req.username.lower() == "humbrol2":
        db.set_admin(user_id, True)

    user = db.get_user_by_id(user_id)
    token = jwt.encode(
        {"user_id": user_id, "username": req.username, "is_admin": user["is_admin"]},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    return {"token": token, "username": req.username, "is_admin": user["is_admin"]}


@app.post("/login")
async def login(req: AuthRequest):
    user = db.get_user(req.username)
    if not user:
        raise HTTPException(401, "Invalid username or password")
    if user["is_banned"]:
        raise HTTPException(403, "Account banned")
    if not bcrypt.checkpw(req.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Invalid username or password")

    token = jwt.encode(
        {"user_id": user["id"], "username": user["username"], "is_admin": user["is_admin"]},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    return {"token": token, "username": user["username"], "is_admin": user["is_admin"]}


def verify_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None


def require_admin(token: str) -> dict:
    """Verify token and check admin. Raises HTTPException if not admin."""
    data = verify_token(token)
    if not data:
        raise HTTPException(401, "Invalid token")
    user = db.get_user_by_id(data["user_id"])
    if not user or not user["is_admin"]:
        raise HTTPException(403, "Admin access required")
    return data


# ── Admin Endpoints ──

@app.get("/admin/users")
async def admin_list_users(token: str):
    require_admin(token)
    return db.list_users()


@app.post("/admin/promote/{user_id}")
async def admin_promote(user_id: int, token: str):
    require_admin(token)
    db.set_admin(user_id, True)
    return {"ok": True}


@app.post("/admin/demote/{user_id}")
async def admin_demote(user_id: int, token: str):
    require_admin(token)
    db.set_admin(user_id, False)
    return {"ok": True}


@app.post("/admin/ban/{user_id}")
async def admin_ban(user_id: int, token: str):
    require_admin(token)
    db.set_banned(user_id, True)
    # Kick if online
    for ws_id, uid in list(ws_to_user.items()):
        if uid == user_id:
            ws = connections.get(ws_id)
            if ws:
                await send_json(ws, {"type": "kicked", "reason": "You have been banned"})
                await ws.close()
    return {"ok": True}


@app.post("/admin/unban/{user_id}")
async def admin_unban(user_id: int, token: str):
    require_admin(token)
    db.set_banned(user_id, False)
    return {"ok": True}


@app.post("/admin/kick/{user_id}")
async def admin_kick(user_id: int, token: str):
    require_admin(token)
    for ws_id, uid in list(ws_to_user.items()):
        if uid == user_id:
            ws = connections.get(ws_id)
            if ws:
                await send_json(ws, {"type": "kicked", "reason": "Kicked by admin"})
                await ws.close()
    return {"ok": True}


@app.get("/admin/chatlog")
async def admin_chatlog(token: str, limit: int = 100):
    require_admin(token)
    return db.get_chat_log(min(limit, 500))


# ── WebSocket ──

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # First message must be auth token
    try:
        auth_raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        auth_msg = json.loads(auth_raw)
        token_data = verify_token(auth_msg.get("token", ""))
        if not token_data:
            await send_json(ws, {"type": "auth_fail", "reason": "invalid_token"})
            await ws.close()
            return
        # Check if user exists and isn't banned
        user_check = db.get_user_by_id(token_data["user_id"])
        if not user_check:
            await send_json(ws, {"type": "auth_fail", "reason": "invalid_token"})
            await ws.close()
            return
        if user_check["is_banned"]:
            await send_json(ws, {"type": "auth_fail", "reason": "banned"})
            await ws.close()
            return
    except (asyncio.TimeoutError, Exception):
        await ws.close()
        return

    user_id = token_data["user_id"]
    username = token_data["username"]
    is_admin = user_check["is_admin"]
    ws_id = str(uuid.uuid4())

    # Kick existing connection for same user (prevents race condition)
    for old_ws_id, old_uid in list(ws_to_user.items()):
        if old_uid == user_id and old_ws_id in connections:
            old_player = players.get_player(old_ws_id)
            if old_player:
                save_player(old_ws_id, old_player)
            old_ws = connections.pop(old_ws_id, None)
            ws_to_user.pop(old_ws_id, None)
            players.remove_player(old_ws_id)
            player_research.pop(old_ws_id, None)
            if old_ws:
                try: await old_ws.close()
                except: pass
            print(f"[AUTH] Kicked old session for {username}")

    # Load player state — clear Redis, force fresh PG read
    db.get_redis().delete(f"player:{user_id}")
    state = db.load_player_state(user_id)

    player = players.add_player(ws_id, name=username)
    player.x = state["x"]
    player.y = state["y"]
    player.inventory = state["inventory"]

    ws_to_user[ws_id] = user_id

    # Load research
    research_data = db.load_research(user_id)
    pr = PlayerResearch.from_dict(research_data) if research_data else PlayerResearch()
    player_research[ws_id] = pr

    # Send registry + player state
    registry = get_client_registry()
    await send_json(ws, {
        "type": "init",
        "player": player.to_dict(),
        "inventory": player.inventory_dict(),
        "is_admin": user_check["is_admin"],
        "tileSize": TILE_PX,
        "chunkSize": CHUNK_SIZE,
        "ups": UPS,
        "researchTree": get_tree_for_client(),
        "research": pr.to_dict(),
        **registry,
        "claims": db.get_all_claims(),
        "claimRadius": 12,
    })

    await send_chunks_around(ws, player)

    connections[ws_id] = ws

    for pid, pws in connections.items():
        if pid != ws_id:
            await send_json(pws, {"type": "player_join", "player": player.to_dict()})

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg["type"]

            if msg_type == "move":
                new_x = msg["x"]
                new_y = msg["y"]

                half = 10
                blocked = False
                for cx_off, cy_off in [(-half, -half), (half, -half), (-half, half), (half, half)]:
                    check_x = int((new_x + cx_off) // TILE_PX)
                    check_y = int((new_y + cy_off) // TILE_PX)
                    tile = world.get_tile(check_x, check_y)
                    if tile in SOLID_TILES or tile == WALL or tile >= 200:
                        blocked = True
                        break

                if not blocked:
                    player.x = new_x
                    player.y = new_y
                    if msg.get("chunk_changed"):
                        await send_chunks_around(ws, player)
                else:
                    await send_json(ws, {
                        "type": "position_correct",
                        "x": player.x, "y": player.y,
                    })

            elif msg_type == "mine_start":
                wx, wy = msg["wx"], msg["wy"]

                # Range check
                player_tx = int(player.x // TILE_PX)
                player_ty = int(player.y // TILE_PX)
                if abs(wx - player_tx) > 3 or abs(wy - player_ty) > 3:
                    await send_json(ws, {"type": "mine_fail", "reason": "too_far"})
                    continue

                # Zone protection
                zone_err = check_zone_permission(wx, wy, user_id, is_admin)
                if zone_err:
                    await send_json(ws, {"type": "mine_fail", "reason": zone_err})
                    continue

                tile = world.get_tile(wx, wy)

                minfo = MINABLE.get(tile)
                if minfo:
                    item_name = minfo["item"]
                    drop_per_mine = minfo["drop"]
                    duration = minfo["time"]
                    max_hp = minfo["hp"]
                    current_hp = world.get_ore_hp(wx, wy)
                    if current_hp is None:
                        current_hp = max_hp
                    mining_sessions[ws_id] = {
                        "wx": wx, "wy": wy,
                        "start": time.time(),
                        "duration": duration,
                        "item": item_name,
                        "count": drop_per_mine,
                        "tile": tile,
                    }
                    await send_json(ws, {
                        "type": "mine_progress",
                        "wx": wx, "wy": wy,
                        "duration": duration,
                        "hp": current_hp,
                        "max_hp": max_hp,
                    })
                else:
                    await send_json(ws, {"type": "mine_fail", "reason": "not_minable"})

            elif msg_type == "mine_complete":
                session = mining_sessions.pop(ws_id, None)
                if session:
                    elapsed = time.time() - session["start"]
                    if elapsed >= session["duration"] * 0.9:
                        wx_s, wy_s = session["wx"], session["wy"]
                        tile_s = session["tile"]

                        # Damage ore HP
                        depleted, remaining_hp = world.damage_ore(wx_s, wy_s, tile_s)

                        player.add_item(session["item"], session["count"])

                        if depleted:
                            # Tile becomes dirt
                            world.set_tile(wx_s, wy_s, DIRT)
                            db.save_world_mod(wx_s, wy_s, DIRT)
                            await broadcast_json({
                                "type": "tile_update",
                                "wx": wx_s, "wy": wy_s, "tile": DIRT,
                            })
                        else:
                            # Send HP update to all nearby players
                            max_hp = world.get_ore_max_hp(tile_s)
                            await broadcast_json({
                                "type": "ore_hp",
                                "wx": wx_s, "wy": wy_s,
                                "hp": remaining_hp, "max_hp": max_hp,
                            })

                        save_player(ws_id, player)
                        await send_json(ws, {
                            "type": "inventory",
                            "inventory": player.inventory_dict(),
                        })
                        await send_json(ws, {
                            "type": "mine_success",
                            "item": session["item"], "count": session["count"],
                        })

            elif msg_type == "mine_cancel":
                mining_sessions.pop(ws_id, None)

            elif msg_type == "build":
                item_name = msg["item"]
                wx, wy = msg["wx"], msg["wy"]

                # Zone protection
                zone_err = check_zone_permission(wx, wy, user_id, is_admin)
                if zone_err:
                    await send_json(ws, {"type": "build_fail", "reason": zone_err})
                    continue

                if item_name not in BUILDABLE:
                    await send_json(ws, {"type": "build_fail", "reason": "unknown_item"})
                    continue

                # Research is enforced at craft time — if player has the crafted item, they researched it
                binfo = BUILDABLE[item_name]
                tile_id = binfo["tile_id"]
                cost = binfo["cost"]
                current_tile = world.get_tile(wx, wy)

                if not player.has_items(cost):
                    await send_json(ws, {"type": "build_fail", "reason": "no_resources"})
                    continue
                if current_tile in SOLID_TILES or current_tile >= 100:
                    await send_json(ws, {"type": "build_fail", "reason": "blocked"})
                    continue

                # Remember what was under it for restoration on removal
                original_tile = world.get_tile(wx, wy)
                player.remove_items(cost)
                world.set_tile(wx, wy, tile_id)
                db.save_world_mod(wx, wy, tile_id)
                building_owners[(wx, wy)] = {"user_id": user_id, "original_tile": original_tile}
                db.save_building_owner(wx, wy, user_id, original_tile)
                await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": tile_id})
                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {"type": "build_success", "item": item_name, "wx": wx, "wy": wy})

            elif msg_type == "remove_building":
                wx, wy = msg["wx"], msg["wy"]
                tile = world.get_tile(wx, wy)
                bdata = building_owners.get((wx, wy))

                removable = {WALL, FLOOR, SIGN}
                if tile not in removable:
                    await send_json(ws, {"type": "build_fail", "reason": "not_a_building"})
                    continue
                if not bdata or bdata["user_id"] != user_id:
                    await send_json(ws, {"type": "build_fail", "reason": "not_yours"})
                    continue

                # Return crafted item
                TILE_TO_ITEM = {WALL: "stone_wall", FLOOR: "stone_path", SIGN: "sign"}
                refund_item = TILE_TO_ITEM.get(tile)
                if refund_item:
                    player.add_item(refund_item, 1)

                if tile == SIGN:
                    db.delete_sign(wx, wy)
                    await broadcast_json({"type": "sign_removed", "wx": wx, "wy": wy})

                # Restore original tile (sand, grass, etc.) instead of always dirt
                restore_tile = bdata.get("original_tile", DIRT)
                # Remove the modification to let original terrain show through
                world._modifications.pop((wx, wy), None)
                db.delete_world_mod(wx, wy)
                building_owners.pop((wx, wy), None)
                db.delete_building_owner(wx, wy)
                await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": restore_tile})
                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {"type": "build_success", "item": "removed", "wx": wx, "wy": wy})

            elif msg_type == "place_machine":
              try:
                machine_type = msg["machine_type"]
                wx, wy = msg["wx"], msg["wy"]

                zone_err = check_zone_permission(wx, wy, user_id, is_admin)
                if zone_err:
                    await send_json(ws, {"type": "build_fail", "reason": zone_err})
                    continue

                if machine_type not in MACHINE_COSTS:
                    await send_json(ws, {"type": "build_fail", "reason": "unknown_machine"})
                    continue

                cost = MACHINE_COSTS[machine_type]
                current_tile = world.get_tile(wx, wy)

                if not player.has_items(cost):
                    await send_json(ws, {"type": "build_fail", "reason": "no_resources"})
                    continue
                if current_tile in SOLID_TILES or current_tile == WALL or current_tile >= 200:
                    await send_json(ws, {"type": "build_fail", "reason": "blocked"})
                    continue
                if machine_mgr.get_at(wx, wy):
                    await send_json(ws, {"type": "build_fail", "reason": "occupied"})
                    continue

                original_tile = world.get_tile(wx, wy)
                player.remove_items(cost)
                machine = machine_mgr.place(machine_type, wx, wy, str(user_id))
                world.set_tile(wx, wy, machine_type)
                db.save_world_mod(wx, wy, machine_type)
                building_owners[(wx, wy)] = {"user_id": user_id, "original_tile": original_tile}
                db.save_building_owner(wx, wy, user_id, original_tile)
                db.save_machine(machine)

                await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": machine_type})
                await broadcast_json({"type": "machine_state", "machine": machine.to_dict()})
                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {"type": "build_success", "item": MACHINE_NAMES[machine_type], "wx": wx, "wy": wy})
              except Exception as e:
                import traceback
                print(f"[ERROR] place_machine failed: {e}")
                traceback.print_exc()
                await send_json(ws, {"type": "build_fail", "reason": "server_error"})

            elif msg_type == "interact_machine":
                wx, wy = msg["wx"], msg["wy"]
                machine = machine_mgr.get_at(wx, wy)
                if machine:
                    await send_json(ws, {"type": "machine_ui", "machine": machine.to_dict()})

            elif msg_type == "machine_set_recipe":
                wx, wy = msg["wx"], msg["wy"]
                recipe = msg["recipe"]
                machine = machine_mgr.get_at(wx, wy)
                if machine and recipe in RECIPES:
                    _, _, required_type = RECIPES[recipe]
                    if machine.machine_type == required_type:
                        machine.recipe = recipe
                        machine.craft_progress = 0.0
                        await send_json(ws, {"type": "machine_ui", "machine": machine.to_dict()})

            elif msg_type == "machine_deposit":
                wx, wy = msg["wx"], msg["wy"]
                item = msg["item"]
                count = msg.get("count", 1)
                machine = machine_mgr.get_at(wx, wy)
                if machine and player.inventory.get(item, 0) >= count:
                    added = machine.add_input(item, count)
                    if added > 0:
                        player.remove_item(item, added)
                        await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                        await send_json(ws, {"type": "machine_ui", "machine": machine.to_dict()})

            elif msg_type == "machine_withdraw":
                wx, wy = msg["wx"], msg["wy"]
                machine = machine_mgr.get_at(wx, wy)
                if machine:
                    items = machine.take_all_output()
                    for item, count in items.items():
                        player.add_item(item, count)
                    if items:
                        await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                        await send_json(ws, {"type": "machine_ui", "machine": machine.to_dict()})

            elif msg_type == "remove_machine":
                wx, wy = msg["wx"], msg["wy"]
                machine = machine_mgr.get_at(wx, wy)
                if machine and machine.owner_id == str(user_id):
                    # Return contents to player
                    for item, count in machine.inventory.items():
                        player.add_item(item, count)
                    for item, count in machine.output.items():
                        player.add_item(item, count)
                    # Return machine item to inventory (for chests)
                    MACHINE_TO_ITEM = {204: "wood_chest", 205: "stone_chest", 206: "copper_chest", 207: "iron_chest"}
                    refund = MACHINE_TO_ITEM.get(machine.machine_type)
                    if refund:
                        player.add_item(refund, 1)

                    machine_mgr.remove(wx, wy)

                    # Restore original tile
                    bdata = building_owners.get((wx, wy))
                    restore_tile = bdata["original_tile"] if bdata else DIRT
                    world._modifications.pop((wx, wy), None)
                    db.delete_world_mod(wx, wy)
                    building_owners.pop((wx, wy), None)
                    db.delete_building_owner(wx, wy)
                    db.delete_machine(wx, wy)

                    await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": restore_tile})
                    await broadcast_json({"type": "machine_removed", "wx": wx, "wy": wy})
                    await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})

            elif msg_type == "request_chunk":
                chunk = world.get_chunk(msg["cx"], msg["cy"])
                await send_json(ws, {
                    "type": "chunk",
                    "cx": chunk.cx, "cy": chunk.cy,
                    "tiles": chunk.to_flat(), "size": CHUNK_SIZE,
                })
                for m in machine_mgr.get_in_chunk(msg["cx"], msg["cy"]):
                    await send_json(ws, {"type": "machine_state", "machine": m.to_dict()})

            elif msg_type == "research_start":
                research_id = msg["id"]
                pr = player_research.get(ws_id)
                if pr and pr.can_research(research_id):
                    node = RESEARCH_TREE[research_id]
                    # Check player has resources
                    if player.has_items(node["cost"]):
                        player.remove_items(node["cost"])
                        pr.start_research(research_id)
                        await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                        await send_json(ws, {"type": "research_update", "research": pr.to_dict()})
                    else:
                        await send_json(ws, {"type": "research_fail", "reason": "no_resources"})
                else:
                    await send_json(ws, {"type": "research_fail", "reason": "unavailable"})

            elif msg_type == "research_cancel":
                pr = player_research.get(ws_id)
                if pr and pr.active:
                    # Refund half the resources
                    node = RESEARCH_TREE[pr.active]
                    for item, count in node["cost"].items():
                        player.add_item(item, max(1, count // 2))
                    pr.cancel()
                    await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                    await send_json(ws, {"type": "research_update", "research": pr.to_dict()})

            elif msg_type == "hand_craft":
                recipe_id = msg.get("item", "")
                qty = min(max(msg.get("qty", 1), 1), 100)

                if recipe_id not in HAND_RECIPES:
                    await send_json(ws, {"type": "craft_fail", "reason": "unknown"})
                    continue

                recipe = HAND_RECIPES[recipe_id]
                # Check player can afford qty * cost
                total_cost = {k: v * qty for k, v in recipe["cost"].items()}
                if not player.has_items(total_cost):
                    await send_json(ws, {"type": "craft_fail", "reason": "no_resources"})
                    continue

                # Check research requirements (from registry)
                required = recipe.get("research")
                pr = player_research.get(ws_id)
                if required and (not pr or not pr.is_completed(required)):
                    await send_json(ws, {"type": "craft_fail", "reason": "not_researched"})
                    continue

                # Deduct resources, add crafted items
                player.remove_items(total_cost)
                produced = recipe["qty"] * qty
                player.add_item(recipe_id, produced)

                # Immediate save
                save_player(ws_id, player)

                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {
                    "type": "craft_success",
                    "item": recipe_id, "qty": produced,
                })

            elif msg_type == "place_claim":
                # Player uses a claim flag at their current position
                if not player.remove_item("claim_flag", 1):
                    await send_json(ws, {"type": "build_fail", "reason": "no_resources"})
                    continue

                tile_x = int(player.x // TILE_PX)
                tile_y = int(player.y // TILE_PX)

                # Check not in spawn zone
                zone = get_zone_at(tile_x, tile_y)
                if zone["admin_only"]:
                    player.add_item("claim_flag", 1)  # refund
                    await send_json(ws, {"type": "build_fail", "reason": "protected_zone"})
                    continue
                if zone.get("claimed"):
                    player.add_item("claim_flag", 1)
                    await send_json(ws, {"type": "build_fail", "reason": "already_claimed"})
                    continue

                claim = db.create_claim(user_id, tile_x, tile_y)
                if not claim:
                    player.add_item("claim_flag", 1)
                    await send_json(ws, {"type": "build_fail", "reason": "claim_limit"})
                    continue

                # Update active claims
                all_claims = db.get_all_claims()
                set_active_claims(all_claims)

                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await broadcast_json({
                    "type": "claim_placed",
                    "claim": claim,
                })
                await send_json(ws, {"type": "build_success", "item": "Claim Flag", "wx": tile_x, "wy": tile_y})

            elif msg_type == "rename_claim":
                claim_id = msg.get("claim_id")
                name = re.sub(r'[<>&]', '', msg.get("name", "").strip()[:30])
                if claim_id and name:
                    if db.rename_claim(claim_id, user_id, name):
                        all_claims = db.get_all_claims()
                        set_active_claims(all_claims)
                        await broadcast_json({"type": "claims_updated", "claims": all_claims})

            elif msg_type == "set_sign_text":
                wx, wy = msg["wx"], msg["wy"]
                text = msg.get("text", "").strip()[:150]
                text = re.sub(r'[<>&]', '', text)
                text = re.sub(r'[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]', '', text)  # preserve newlines
                tile = world.get_tile(wx, wy)
                bdata = building_owners.get((wx, wy))
                if tile == SIGN and bdata and bdata["user_id"] == user_id and text:
                    db.save_sign(wx, wy, text, user_id)
                    await broadcast_json({
                        "type": "sign_data",
                        "sign": {"wx": wx, "wy": wy, "text": text, "owner_id": user_id},
                    })

            elif msg_type == "get_sign":
                wx, wy = msg["wx"], msg["wy"]
                sign = db.get_sign(wx, wy)
                if sign:
                    await send_json(ws, {"type": "sign_data", "sign": sign})

            elif msg_type == "chat":
                text = msg.get("text", "").strip()[:200]
                # Sanitize: strip control chars, HTML tags
                text = re.sub(r'[<>&]', '', text)
                text = re.sub(r'[\x00-\x1f\x7f]', '', text)
                if text:
                    # Log to database (parameterized query — SQL injection safe)
                    db.log_chat(user_id, player.name, text)
                    await broadcast_json({
                        "type": "chat",
                        "name": player.name,
                        "text": text,
                        "t": time.time(),
                    })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error for {ws_id}: {e}")
    finally:
        connections.pop(ws_id, None)
        mining_sessions.pop(ws_id, None)
        # Save player state + research on disconnect
        save_player(ws_id, player)
        pr = player_research.pop(ws_id, None)
        if pr:
            uid = ws_to_user.get(ws_id)
            if uid:
                db.save_research(uid, pr.to_dict())
        ws_to_user.pop(ws_id, None)
        players.remove_player(ws_id)
        for pid, pws in connections.items():
            await send_json(pws, {"type": "player_leave", "id": ws_id})


async def game_loop():
    respawn_check_counter = 0
    while True:
        start = time.time()
        dt = TICK_INTERVAL

        events = machine_mgr.tick(dt, world)

        # Tick NPC AI
        npc_mgr.tick(dt, world)

        # Tick research for all online players (every tick = 0.1s)
        for ws_id, pr in list(player_research.items()):
            completed = pr.tick(dt)
            if completed:
                ws = connections.get(ws_id)
                if ws:
                    await send_json(ws, {
                        "type": "research_complete",
                        "id": completed,
                        "research": pr.to_dict(),
                    })
                # Save research progress
                uid = ws_to_user.get(ws_id)
                if uid:
                    db.save_research(uid, pr.to_dict())

        # Check ore respawns every 5 seconds (not every tick)
        respawn_check_counter += 1
        if respawn_check_counter >= UPS * 5:
            respawn_check_counter = 0
            respawned = world.tick_respawns()
            for wx, wy, tile_id in respawned:
                # Delete the DB modification so it doesn't reload as dirt
                db.delete_world_mod(wx, wy)
                await broadcast_json({
                    "type": "tile_update",
                    "wx": wx, "wy": wy, "tile": tile_id,
                })

        if connections:
            all_players = players.get_all()
            all_npcs = npc_mgr.get_all()
            state = {
                "type": "state",
                "players": [p.to_dict() for p in all_players],
                "npcs": [a.to_dict() for a in all_npcs],
                "t": time.time(),
            }
            msg = json.dumps(state)
            for ws in list(connections.values()):
                try:
                    await ws.send_text(msg)
                except Exception:
                    pass

        elapsed = time.time() - start
        await asyncio.sleep(max(0, TICK_INTERVAL - elapsed))


async def auto_save_loop():
    """Periodically save all player states and world state."""
    while True:
        await asyncio.sleep(SAVE_INTERVAL)
        # Save all online players
        for ws_id, player in [(wid, players.get_player(wid)) for wid in list(ws_to_user.keys())]:
            if player:
                save_player(ws_id, player)
        # Save machines
        db.save_all_machines(machine_mgr.get_all())
        print(f"[SAVE] Auto-saved {len(ws_to_user)} players, {len(machine_mgr.get_all())} machines")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
