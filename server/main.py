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

from world import (
    WorldGenerator, CHUNK_SIZE, MINABLE_TILES, BUILDABLE,
    DIRT, SOLID_TILES, WALL,
)
from player import PlayerManager, Player
from machines import (
    MachineManager, Machine, MACHINE_COSTS, MACHINE_MINER, MACHINE_FABRICATOR,
    MACHINE_STORAGE, MACHINE_FURNACE, RECIPES, MACHINE_NAMES,
)
import database as db
from research import PlayerResearch, RESEARCH_TREE, get_tree_for_client

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
connections: dict[str, WebSocket] = {}
mining_sessions: dict[str, dict] = {}
# Map ws_id -> user_id for persistence
ws_to_user: dict[str, int] = {}
# Research state per ws_id
player_research: dict[str, PlayerResearch] = {}


def load_world_state():
    """Load persisted world modifications and machines on startup."""
    # Load tile modifications
    mods = db.load_world_mods()
    world._modifications = mods
    print(f"[INIT] Loaded {len(mods)} tile modifications")

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
        # Check if banned
        user_check = db.get_user_by_id(token_data["user_id"])
        if not user_check or user_check["is_banned"]:
            await send_json(ws, {"type": "auth_fail", "reason": "banned"})
            await ws.close()
            return
    except (asyncio.TimeoutError, Exception):
        await ws.close()
        return

    user_id = token_data["user_id"]
    username = token_data["username"]
    ws_id = str(uuid.uuid4())

    # Load persisted player state
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

    # Build recipes info for client
    recipes_info = {}
    for output, (inputs, craft_time, machine_type) in RECIPES.items():
        recipes_info[output] = {
            "inputs": inputs,
            "time": craft_time,
            "machine": MACHINE_NAMES.get(machine_type, "Unknown"),
            "machine_type": machine_type,
        }

    await send_json(ws, {
        "type": "init",
        "player": player.to_dict(),
        "inventory": player.inventory_dict(),
        "is_admin": user_check["is_admin"],
        "tileSize": TILE_PX,
        "chunkSize": CHUNK_SIZE,
        "ups": UPS,
        "buildable": {k: {"cost": v[1]} for k, v in BUILDABLE.items()},
        "machineCosts": {str(k): v for k, v in MACHINE_COSTS.items()},
        "recipes": recipes_info,
        "researchTree": get_tree_for_client(),
        "research": pr.to_dict(),
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
                tile = world.get_tile(wx, wy)

                if tile in MINABLE_TILES:
                    item_name, drop_per_mine, duration, max_hp = MINABLE_TILES[tile]
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

                if item_name not in BUILDABLE:
                    await send_json(ws, {"type": "build_fail", "reason": "unknown_item"})
                    continue

                tile_id, cost = BUILDABLE[item_name]
                current_tile = world.get_tile(wx, wy)

                if not player.has_items(cost):
                    await send_json(ws, {"type": "build_fail", "reason": "no_resources"})
                    continue
                if current_tile in SOLID_TILES or current_tile == WALL or current_tile >= 200:
                    await send_json(ws, {"type": "build_fail", "reason": "blocked"})
                    continue

                player.remove_items(cost)
                world.set_tile(wx, wy, tile_id)
                db.save_world_mod(wx, wy, tile_id)
                await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": tile_id})
                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {"type": "build_success", "item": item_name, "wx": wx, "wy": wy})

            elif msg_type == "place_machine":
                machine_type = msg["machine_type"]
                wx, wy = msg["wx"], msg["wy"]

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

                player.remove_items(cost)
                machine = machine_mgr.place(machine_type, wx, wy, str(user_id))
                world.set_tile(wx, wy, machine_type)
                db.save_world_mod(wx, wy, machine_type)
                db.save_machine(machine)

                await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": machine_type})
                await broadcast_json({"type": "machine_state", "machine": machine.to_dict()})
                await send_json(ws, {"type": "inventory", "inventory": player.inventory_dict()})
                await send_json(ws, {"type": "build_success", "item": MACHINE_NAMES[machine_type], "wx": wx, "wy": wy})

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
                    for item, count in machine.inventory.items():
                        player.add_item(item, count)
                    for item, count in machine.output.items():
                        player.add_item(item, count)
                    machine_mgr.remove(wx, wy)
                    world.set_tile(wx, wy, DIRT)
                    db.save_world_mod(wx, wy, DIRT)
                    db.delete_machine(wx, wy)
                    await broadcast_json({"type": "tile_update", "wx": wx, "wy": wy, "tile": DIRT})
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
                await broadcast_json({
                    "type": "tile_update",
                    "wx": wx, "wy": wy, "tile": tile_id,
                })

        if connections:
            all_players = players.get_all()
            state = {
                "type": "state",
                "players": [p.to_dict() for p in all_players],
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
