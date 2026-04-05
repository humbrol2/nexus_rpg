"""PostgreSQL + Redis database layer for SpaceColony."""

import json
import psycopg2
import psycopg2.extras
import redis

# ── Connection Config ──

PG_CONFIG = {
    "host": "10.0.0.54",
    "port": 5432,
    "dbname": "spacecolony",
    "user": "humbrol2",
    "password": "3e1779ab4980bd4c7133eb457f8d3a0b",
}

REDIS_CONFIG = {
    "host": "10.0.0.54",
    "port": 6379,
    "password": "7e23dd7cf7c7aea497add4e479173480",
    "db": 2,  # dedicated db for spacecolony
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
    # Fresh connection to avoid stale data from connection pooling
    conn = psycopg2.connect(**PG_CONFIG)
    conn.autocommit = True
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT x, y, inventory FROM player_state WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    conn.close()
    if row:
        inv = row["inventory"]
        if isinstance(inv, str):
            inv = json.loads(inv)
        return {"x": row["x"], "y": row["y"], "inventory": inv}
    return {"x": 1024.0, "y": 1024.0, "inventory": {}}


def save_player_state(user_id: int, x: float, y: float, inventory: dict) -> None:
    # Write directly to PostgreSQL
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO player_state (user_id, x, y, inventory, updated_at)
               VALUES (%s, %s, %s, %s, NOW())
               ON CONFLICT (user_id) DO UPDATE SET
                   x=EXCLUDED.x, y=EXCLUDED.y,
                   inventory=EXCLUDED.inventory,
                   updated_at=NOW()""",
            (user_id, x, y, json.dumps(inventory)),
        )


# ── Building Ownership ──

def load_building_owners() -> dict[tuple[int, int], dict]:
    """Returns {(wx,wy): {"user_id": int, "original_tile": int}}"""
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("SELECT wx, wy, user_id, original_tile FROM building_owners")
        return {(r[0], r[1]): {"user_id": r[2], "original_tile": r[3]} for r in cur.fetchall()}


def save_building_owner(wx: int, wy: int, user_id: int, original_tile: int = 3) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO building_owners (wx, wy, user_id, original_tile) VALUES (%s, %s, %s, %s)
               ON CONFLICT (wx, wy) DO UPDATE SET user_id=EXCLUDED.user_id, original_tile=EXCLUDED.original_tile""",
            (wx, wy, user_id, original_tile),
        )


def delete_building_owner(wx: int, wy: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM building_owners WHERE wx = %s AND wy = %s", (wx, wy))


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

def load_world_mods() -> dict[tuple[int, int], int]:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("SELECT wx, wy, tile_id FROM world_mods")
        return {(r[0], r[1]): r[2] for r in cur.fetchall()}


def save_world_mod(wx: int, wy: int, tile_id: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO world_mods (wx, wy, tile_id) VALUES (%s, %s, %s)
               ON CONFLICT (wx, wy) DO UPDATE SET tile_id=EXCLUDED.tile_id""",
            (wx, wy, tile_id),
        )


def delete_world_mod(wx: int, wy: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM world_mods WHERE wx = %s AND wy = %s", (wx, wy))


# ── Machines ──

def load_machines() -> list[dict]:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe FROM machines"
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
            """INSERT INTO machines (machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (machine_id) DO UPDATE SET
                   inventory=EXCLUDED.inventory, output=EXCLUDED.output, recipe=EXCLUDED.recipe""",
            (m.machine_id, m.machine_type, m.wx, m.wy, m.owner_id,
             json.dumps(m.inventory), json.dumps(m.output), m.recipe),
        )


def delete_machine(wx: int, wy: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM machines WHERE wx = %s AND wy = %s", (wx, wy))


def save_all_machines(machines: list) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        for m in machines:
            cur.execute(
                """INSERT INTO machines (machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (machine_id) DO UPDATE SET
                       inventory=EXCLUDED.inventory, output=EXCLUDED.output, recipe=EXCLUDED.recipe""",
                (m.machine_id, m.machine_type, m.wx, m.wy, m.owner_id,
                 json.dumps(m.inventory), json.dumps(m.output), m.recipe),
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

def save_sign(wx: int, wy: int, text: str, owner_id: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO signs (wx, wy, text, owner_id) VALUES (%s, %s, %s, %s)
               ON CONFLICT (wx, wy) DO UPDATE SET text=EXCLUDED.text""",
            (wx, wy, text, owner_id),
        )


def get_sign(wx: int, wy: int) -> dict | None:
    pg = get_pg()
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT wx, wy, text, owner_id FROM signs WHERE wx = %s AND wy = %s", (wx, wy))
        row = cur.fetchone()
        return dict(row) if row else None


def get_signs_in_chunk(cx: int, cy: int, chunk_size: int = 64) -> list[dict]:
    pg = get_pg()
    bx, by = cx * chunk_size, cy * chunk_size
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT wx, wy, text, owner_id FROM signs WHERE wx >= %s AND wx < %s AND wy >= %s AND wy < %s",
            (bx, bx + chunk_size, by, by + chunk_size),
        )
        return [dict(r) for r in cur.fetchall()]


def delete_sign(wx: int, wy: int) -> None:
    pg = get_pg()
    with pg.cursor() as cur:
        cur.execute("DELETE FROM signs WHERE wx = %s AND wy = %s", (wx, wy))


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
