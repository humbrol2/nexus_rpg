"""SQLite database for persistence — users, player state, world mods, machines."""

import sqlite3
import json
import os
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), "spacecolony.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if they don't exist."""
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                is_banned INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS player_state (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                x REAL NOT NULL DEFAULT 1024.0,
                y REAL NOT NULL DEFAULT 1024.0,
                inventory TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS world_mods (
                wx INTEGER NOT NULL,
                wy INTEGER NOT NULL,
                tile_id INTEGER NOT NULL,
                PRIMARY KEY (wx, wy)
            );

            CREATE TABLE IF NOT EXISTS machines (
                machine_id TEXT PRIMARY KEY,
                machine_type INTEGER NOT NULL,
                wx INTEGER NOT NULL,
                wy INTEGER NOT NULL,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                inventory TEXT NOT NULL DEFAULT '{}',
                output TEXT NOT NULL DEFAULT '{}',
                recipe TEXT,
                UNIQUE(wx, wy)
            );

            CREATE TABLE IF NOT EXISTS player_research (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                research_data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS chat_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Migrations for existing DBs
        try:
            db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # column already exists
        try:
            db.execute("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass


# ── Users ──

def create_user(username: str, password_hash: str) -> int | None:
    """Create a user. Returns user ID or None if username taken."""
    try:
        with get_db() as db:
            cursor = db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            user_id = cursor.lastrowid
            # Create default player state
            db.execute(
                "INSERT INTO player_state (user_id) VALUES (?)",
                (user_id,),
            )
            return user_id
    except sqlite3.IntegrityError:
        return None


def get_user(username: str) -> dict | None:
    with get_db() as db:
        row = db.execute(
            "SELECT id, username, password_hash, is_admin, is_banned FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if row:
            return {
                "id": row["id"], "username": row["username"],
                "password_hash": row["password_hash"],
                "is_admin": bool(row["is_admin"]),
                "is_banned": bool(row["is_banned"]),
            }
    return None


def get_user_by_id(user_id: int) -> dict | None:
    with get_db() as db:
        row = db.execute(
            "SELECT id, username, is_admin, is_banned FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row:
            return {
                "id": row["id"], "username": row["username"],
                "is_admin": bool(row["is_admin"]),
                "is_banned": bool(row["is_banned"]),
            }
    return None


def list_users() -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT id, username, is_admin, is_banned, created_at FROM users ORDER BY id"
        ).fetchall()
        return [
            {
                "id": row["id"], "username": row["username"],
                "is_admin": bool(row["is_admin"]),
                "is_banned": bool(row["is_banned"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]


def set_admin(user_id: int, is_admin: bool) -> None:
    with get_db() as db:
        db.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(is_admin), user_id))


def set_banned(user_id: int, is_banned: bool) -> None:
    with get_db() as db:
        db.execute("UPDATE users SET is_banned = ? WHERE id = ?", (int(is_banned), user_id))


# ── Player State ──

def load_player_state(user_id: int) -> dict:
    with get_db() as db:
        row = db.execute(
            "SELECT x, y, inventory FROM player_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row:
            return {
                "x": row["x"],
                "y": row["y"],
                "inventory": json.loads(row["inventory"]),
            }
    return {"x": 1024.0, "y": 1024.0, "inventory": {}}


def load_research(user_id: int) -> dict:
    with get_db() as db:
        row = db.execute(
            "SELECT research_data FROM player_research WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row:
            return json.loads(row["research_data"])
    return {}


def save_research(user_id: int, research_data: dict) -> None:
    with get_db() as db:
        db.execute(
            """INSERT INTO player_research (user_id, research_data) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET research_data=excluded.research_data""",
            (user_id, json.dumps(research_data)),
        )


# ── Chat Log ──

def log_chat(user_id: int, username: str, message: str) -> None:
    """Log a chat message. Uses parameterized queries — safe from SQL injection."""
    with get_db() as db:
        db.execute(
            "INSERT INTO chat_log (user_id, username, message) VALUES (?, ?, ?)",
            (user_id, username, message),
        )


def get_chat_log(limit: int = 100) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT id, user_id, username, message, created_at FROM chat_log ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {"id": r["id"], "user_id": r["user_id"], "username": r["username"],
             "message": r["message"], "created_at": r["created_at"]}
            for r in reversed(rows)
        ]


def save_player_state(user_id: int, x: float, y: float, inventory: dict) -> None:
    with get_db() as db:
        db.execute(
            """INSERT INTO player_state (user_id, x, y, inventory, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id) DO UPDATE SET
                   x=excluded.x, y=excluded.y,
                   inventory=excluded.inventory,
                   updated_at=CURRENT_TIMESTAMP""",
            (user_id, x, y, json.dumps(inventory)),
        )


# ── World Modifications ──

def load_world_mods() -> dict[tuple[int, int], int]:
    """Load all tile modifications. Returns {(wx, wy): tile_id}."""
    mods = {}
    with get_db() as db:
        for row in db.execute("SELECT wx, wy, tile_id FROM world_mods"):
            mods[(row["wx"], row["wy"])] = row["tile_id"]
    return mods


def save_world_mod(wx: int, wy: int, tile_id: int) -> None:
    with get_db() as db:
        db.execute(
            """INSERT INTO world_mods (wx, wy, tile_id) VALUES (?, ?, ?)
               ON CONFLICT(wx, wy) DO UPDATE SET tile_id=excluded.tile_id""",
            (wx, wy, tile_id),
        )


def delete_world_mod(wx: int, wy: int) -> None:
    with get_db() as db:
        db.execute("DELETE FROM world_mods WHERE wx = ? AND wy = ?", (wx, wy))


# ── Machines ──

def load_machines() -> list[dict]:
    """Load all machines from DB."""
    machines = []
    with get_db() as db:
        for row in db.execute(
            "SELECT machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe FROM machines"
        ):
            machines.append({
                "machine_id": row["machine_id"],
                "machine_type": row["machine_type"],
                "wx": row["wx"],
                "wy": row["wy"],
                "owner_id": row["owner_id"],
                "inventory": json.loads(row["inventory"]),
                "output": json.loads(row["output"]),
                "recipe": row["recipe"],
            })
    return machines


def save_machine(m) -> None:
    """Save or update a machine. Accepts a Machine object."""
    with get_db() as db:
        db.execute(
            """INSERT INTO machines (machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(machine_id) DO UPDATE SET
                   inventory=excluded.inventory, output=excluded.output, recipe=excluded.recipe""",
            (m.machine_id, m.machine_type, m.wx, m.wy, m.owner_id,
             json.dumps(m.inventory), json.dumps(m.output), m.recipe),
        )


def delete_machine(wx: int, wy: int) -> None:
    with get_db() as db:
        db.execute("DELETE FROM machines WHERE wx = ? AND wy = ?", (wx, wy))


def save_all_machines(machines: list) -> None:
    """Bulk save all machines."""
    with get_db() as db:
        for m in machines:
            db.execute(
                """INSERT INTO machines (machine_id, machine_type, wx, wy, owner_id, inventory, output, recipe)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(machine_id) DO UPDATE SET
                       inventory=excluded.inventory, output=excluded.output, recipe=excluded.recipe""",
                (m.machine_id, m.machine_type, m.wx, m.wy, m.owner_id,
                 json.dumps(m.inventory), json.dumps(m.output), m.recipe),
            )
