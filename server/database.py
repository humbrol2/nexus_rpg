"""PostgreSQL + Redis database layer for SpaceColony."""

import json
import os
import psycopg2
import psycopg2.extras
import redis

# Load .env file if present (for local dev / systemd EnvironmentFile)
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Connection Config (from environment variables) ──

PG_CONFIG = {
    "host": os.environ.get("SC_PG_HOST", "10.0.0.54"),
    "port": int(os.environ.get("SC_PG_PORT", "5432")),
    "dbname": os.environ.get("SC_PG_DB", "spacecolony"),
    "user": os.environ.get("SC_PG_USER", "humbrol2"),
    "password": os.environ.get("SC_PG_PASSWORD", ""),
}

REDIS_CONFIG = {
    "host": os.environ.get("SC_REDIS_HOST", "10.0.0.54"),
    "port": int(os.environ.get("SC_REDIS_PORT", "6379")),
    "password": os.environ.get("SC_REDIS_PASSWORD", ""),
    "db": int(os.environ.get("SC_REDIS_DB", "2")),
    "decode_responses": True,
}

# ── Connections ──

_pg_conn = None
_redis_conn = None


def get_pg():
    global _pg_conn
    if _pg_conn is None or _pg_conn.closed:
        _pg_conn = psycopg2.connect(**PG_CONFIG)
        _pg_conn.autocommit = True
    # Ensure we see latest data (reset any stale transaction state)
    try:
        _pg_conn.rollback()
    except:
        _pg_conn = psycopg2.connect(**PG_CONFIG)
        _pg_conn.autocommit = True
    return _pg_conn


def get_redis() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.Redis(**REDIS_CONFIG)
    return _redis_conn


def init_db() -> None:
    """Verify connection and tables exist."""
    pg = get_pg()
    r = get_redis()
    r.ping()
    print(f"[DB] PostgreSQL connected: {PG_CONFIG['host']}")
    print(f"[DB] Redis connected: {REDIS_CONFIG['host']}")
    # Migrations
    with pg.cursor() as cur:
        cur.execute("""
            ALTER TABLE player_state ADD COLUMN IF NOT EXISTS hp INTEGER DEFAULT 100
        """)


# ── Users ──

def create_user(username: str, password_hash: str) -> int | None:
    try:
        pg = get_pg()
        with pg.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING id",
                (username, password_hash),
            )
            user_id = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO player_state (user_id) VALUES (%s)",
                (user_id,),
            )
            return user_id
    except psycopg2.IntegrityError:
        pg.rollback() if not pg.autocommit else None
        return None


def get_user(username: str) -> dict | None:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, username, password_hash, is_admin, is_banned FROM users WHERE username = %s",
            (username,),
        )
        row = cur.fetchone()
        if row:
            return dict(row)
    return None


def get_user_by_id(user_id: int) -> dict | None:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, username, is_admin, is_banned FROM users WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if row:
            return dict(row)
    return None


def list_users() -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, username, is_admin, is_banned, created_at FROM users ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


def set_admin(user_id: int, is_admin: bool) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("UPDATE users SET is_admin = %s WHERE id = %s", (is_admin, user_id))


def set_banned(user_id: int, is_banned: bool) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("UPDATE users SET is_banned = %s WHERE id = %s", (is_banned, user_id))


# ── Player State ──

def load_player_state(user_id: int) -> dict:
    # Use main connection with rollback to ensure fresh read
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT x, y, z, inventory, hp FROM player_state WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if row:
        inv = row["inventory"]
        if isinstance(inv, str):
            inv = json.loads(inv)
        return {
            "x": row["x"], "y": row["y"], "z": row.get("z", 0),
            "inventory": inv, "hp": row.get("hp", 100),
        }
    return {"x": 1024.0, "y": 1024.0, "z": 0, "inventory": {}, "hp": 100}


def save_player_state(user_id: int, x: float, y: float, inventory: dict, z: int = 0, hp: int = 100) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO player_state (user_id, x, y, z, inventory, hp, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, NOW())
               ON CONFLICT (user_id) DO UPDATE SET
                   x=EXCLUDED.x, y=EXCLUDED.y, z=EXCLUDED.z,
                   inventory=EXCLUDED.inventory, hp=EXCLUDED.hp,
                   updated_at=NOW()""",
            (user_id, x, y, z, json.dumps(inventory), hp),
        )


# ── Building Ownership ──

def load_building_owners() -> dict[tuple[int, int, int], dict]:
    """Returns {(wx,wy,wz): {"user_id": int, "original_tile": int}}"""
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("SELECT wx, wy, COALESCE(wz, 0), user_id, original_tile FROM building_owners")
        return {(r[0], r[1], r[2]): {"user_id": r[3], "original_tile": r[4]} for r in cur.fetchall()}


def save_building_owner(wx: int, wy: int, user_id: int, original_tile: int = 3, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO building_owners (wx, wy, wz, user_id, original_tile) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (wx, wy, wz) DO UPDATE SET user_id=EXCLUDED.user_id, original_tile=EXCLUDED.original_tile""",
            (wx, wy, wz, user_id, original_tile),
        )


def delete_building_owner(wx: int, wy: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM building_owners WHERE wx = %s AND wy = %s AND wz = %s", (wx, wy, wz))


# ── Research ──

def load_research(user_id: int) -> dict:
    r = get_redis()
    cached = r.get(f"research:{user_id}")
    if cached:
        return json.loads(cached)

    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("SELECT research_data FROM player_research WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if row:
            data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            r.setex(f"research:{user_id}", 300, json.dumps(data))
            return data
    return {}


def save_research(user_id: int, research_data: dict) -> None:
    r = get_redis()
    r.setex(f"research:{user_id}", 300, json.dumps(research_data))

    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO player_research (user_id, research_data) VALUES (%s, %s)
               ON CONFLICT (user_id) DO UPDATE SET research_data=EXCLUDED.research_data""",
            (user_id, json.dumps(research_data)),
        )


# ── World Modifications ──

def load_world_mods() -> dict[tuple[int, int, int], int]:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("SELECT wx, wy, COALESCE(wz, 0), tile_id FROM world_mods")
        return {(r[0], r[1], r[2]): r[3] for r in cur.fetchall()}


def save_world_mod(wx: int, wy: int, tile_id: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO world_mods (wx, wy, wz, tile_id) VALUES (%s, %s, %s, %s)
               ON CONFLICT (wx, wy, wz) DO UPDATE SET tile_id=EXCLUDED.tile_id""",
            (wx, wy, wz, tile_id),
        )


def delete_world_mod(wx: int, wy: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM world_mods WHERE wx = %s AND wy = %s AND wz = %s", (wx, wy, wz))


# ── Machines ──

def load_machines() -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT machine_id, machine_type, wx, wy, COALESCE(wz, 0) as wz, owner_id, inventory, output, recipe FROM machines"
        )
        machines = []
        for row in cur.fetchall():
            m = dict(row)
            if isinstance(m["inventory"], str):
                m["inventory"] = json.loads(m["inventory"])
            if isinstance(m["output"], str):
                m["output"] = json.loads(m["output"])
            machines.append(m)
        return machines


def save_machine(m) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO machines (machine_id, machine_type, wx, wy, wz, owner_id, inventory, output, recipe)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (machine_id) DO UPDATE SET
                   inventory=EXCLUDED.inventory, output=EXCLUDED.output, recipe=EXCLUDED.recipe""",
            (m.machine_id, m.machine_type, m.wx, m.wy, m.wz, m.owner_id,
             json.dumps(m.inventory), json.dumps(m.output), m.recipe),
        )


def delete_machine(wx: int, wy: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM machines WHERE wx = %s AND wy = %s AND wz = %s", (wx, wy, wz))


def save_all_machines(machines: list) -> None:
    if not machines:
        return
    pg = get_pg()
    with pg.cursor() as cur:
        # Batch upsert using execute_values for much better performance
        from psycopg2.extras import execute_values
        values = [
            (m.machine_id, m.machine_type, m.wx, m.wy, m.wz, m.owner_id,
             json.dumps(m.inventory), json.dumps(m.output), m.recipe)
            for m in machines
        ]
        execute_values(
            cur,
            """INSERT INTO machines (machine_id, machine_type, wx, wy, wz, owner_id, inventory, output, recipe)
               VALUES %s
               ON CONFLICT (machine_id) DO UPDATE SET
                   inventory=EXCLUDED.inventory, output=EXCLUDED.output, recipe=EXCLUDED.recipe""",
            values,
            page_size=200,
        )


def save_all_players(player_data: list[tuple[int, float, float, int, dict]]) -> None:
    """Batch save player states. Each entry: (user_id, x, y, z, inventory)."""
    if not player_data:
        return
    pg = get_pg()
    with pg.cursor() as cur:
        from psycopg2.extras import execute_values
        values = [(uid, x, y, z, json.dumps(inv)) for uid, x, y, z, inv in player_data]
        execute_values(
            cur,
            """INSERT INTO player_state (user_id, x, y, z, inventory, updated_at)
               VALUES %s
               ON CONFLICT (user_id) DO UPDATE SET
                   x=EXCLUDED.x, y=EXCLUDED.y, z=EXCLUDED.z,
                   inventory=EXCLUDED.inventory,
                   updated_at=NOW()""",
            values,
            page_size=200,
        )


# ── Chat Log ──

# ── Signs ──

# ── Land Claims ──

CLAIM_RADIUS = 12  # 25x25 = radius 12 from center
MAX_CLAIMS = 5

def get_all_claims() -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, user_id, center_x, center_y, name FROM land_claims")
        return [dict(r) for r in cur.fetchall()]


def get_user_claims(user_id: int) -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, user_id, center_x, center_y, name FROM land_claims WHERE user_id = %s", (user_id,))
        return [dict(r) for r in cur.fetchall()]


def create_claim(user_id: int, center_x: int, center_y: int, name: str = "My Claim") -> dict | None:
    """Create a land claim. Returns claim dict or None if limit reached or overlap."""
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Check limit
        cur.execute("SELECT COUNT(*) as cnt FROM land_claims WHERE user_id = %s", (user_id,))
        if cur.fetchone()["cnt"] >= MAX_CLAIMS:
            return None
        # Check overlap with existing claims
        cur.execute(
            """SELECT id FROM land_claims
               WHERE ABS(center_x - %s) < %s AND ABS(center_y - %s) < %s""",
            (center_x, CLAIM_RADIUS * 2, center_y, CLAIM_RADIUS * 2),
        )
        if cur.fetchone():
            return None  # overlaps
        try:
            cur.execute(
                "INSERT INTO land_claims (user_id, center_x, center_y, name) VALUES (%s, %s, %s, %s) RETURNING id, user_id, center_x, center_y, name",
                (user_id, center_x, center_y, name),
            )
            return dict(cur.fetchone())
        except Exception:
            return None


def delete_claim(claim_id: int, user_id: int) -> bool:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM land_claims WHERE id = %s AND user_id = %s", (claim_id, user_id))
        return cur.rowcount > 0


def rename_claim(claim_id: int, user_id: int, name: str) -> bool:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("UPDATE land_claims SET name = %s WHERE id = %s AND user_id = %s", (name, claim_id, user_id))
        return cur.rowcount > 0


# ── Signs ──

def save_sign(wx: int, wy: int, text: str, owner_id: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO signs (wx, wy, wz, text, owner_id) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (wx, wy, wz) DO UPDATE SET text=EXCLUDED.text""",
            (wx, wy, wz, text, owner_id),
        )


def get_sign(wx: int, wy: int, wz: int = 0) -> dict | None:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT wx, wy, wz, text, owner_id FROM signs WHERE wx = %s AND wy = %s AND wz = %s", (wx, wy, wz))
        row = cur.fetchone()
        return dict(row) if row else None


def get_signs_in_chunk(cx: int, cy: int, chunk_size: int = 64, cz: int = 0) -> list[dict]:
    pg = get_pg()
    bx, by = cx * chunk_size, cy * chunk_size
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT wx, wy, wz, text, owner_id FROM signs WHERE wx >= %s AND wx < %s AND wy >= %s AND wy < %s AND wz = %s",
            (bx, bx + chunk_size, by, by + chunk_size, cz),
        )
        return [dict(r) for r in cur.fetchall()]


def delete_sign(wx: int, wy: int, wz: int = 0) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM signs WHERE wx = %s AND wy = %s AND wz = %s", (wx, wy, wz))


# ── Chat Log ──

def log_chat(user_id: int, username: str, message: str) -> None:
    # Also push to Redis for fast recent chat retrieval
    r = get_redis()
    r.lpush("chat:recent", json.dumps({"user_id": user_id, "username": username, "message": message}))
    r.ltrim("chat:recent", 0, 99)  # keep last 100

    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            "INSERT INTO chat_log (user_id, username, message) VALUES (%s, %s, %s)",
            (user_id, username, message),
        )


def get_chat_log(limit: int = 100) -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, user_id, username, message, created_at FROM chat_log ORDER BY id DESC LIMIT %s",
            (limit,),
        )
        return [dict(r) for r in reversed(cur.fetchall())]
