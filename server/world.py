"""Procedural world generation using layered simplex noise."""

import time
from dataclasses import dataclass
from opensimplex import OpenSimplex
from item_registry import TILES, MINABLE, BUILDABLE, ITEMS

CHUNK_SIZE = 64

# Derive constants from registry
SOLID_TILES = {tid for tid, t in TILES.items() if t["solid"]}
TILE_SPEED = {tid: t["speed"] for tid, t in TILES.items() if t["speed"] != 1.0}
RESPAWN_TIMES = {tid: m["respawn"] for tid, m in MINABLE.items() if m["respawn"] > 0}

# Tile ID shortcuts (used in generation)
DEEP_WATER = 0
WATER = 1
SAND = 2
DIRT = 3
ALIEN_GRASS = 4
ROCK = 5
DENSE_ROCK = 6
ORE_IRON = 7
ORE_COPPER = 8
ALIEN_FLORA = 9
CRYSTAL = 10
ALIEN_TREE = 11
WALL = 100
FLOOR = 101


@dataclass
class Chunk:
    cx: int
    cy: int
    tiles: list[list[int]]

    def to_flat(self) -> list[int]:
        flat = []
        for row in self.tiles:
            flat.extend(row)
        return flat


class WorldGenerator:
    def __init__(self, seed: int = 42):
        self.seed = seed
        self._elevation = OpenSimplex(seed)
        self._moisture = OpenSimplex(seed + 1)
        self._ore = OpenSimplex(seed + 2)
        self._detail = OpenSimplex(seed + 3)
        self._chunk_cache: dict[tuple[int, int], Chunk] = {}
        self._modifications: dict[tuple[int, int], int] = {}
        self._ore_hp: dict[tuple[int, int], int] = {}
        self._respawn_queue: dict[tuple[int, int], tuple[int, float]] = {}

    def get_ore_hp(self, wx: int, wy: int) -> int | None:
        return self._ore_hp.get((wx, wy))

    def get_ore_max_hp(self, tile_id: int) -> int:
        if tile_id in MINABLE:
            return MINABLE[tile_id]["hp"]
        return 1

    def get_minable_info(self, tile_id: int) -> dict | None:
        return MINABLE.get(tile_id)

    def damage_ore(self, wx: int, wy: int, tile_id: int) -> tuple[bool, int]:
        key = (wx, wy)
        max_hp = self.get_ore_max_hp(tile_id)
        current = self._ore_hp.get(key, max_hp)
        current -= 1
        if current <= 0:
            self._ore_hp.pop(key, None)
            respawn_time = RESPAWN_TIMES.get(tile_id, 0)
            if respawn_time > 0:
                self._respawn_queue[key] = (tile_id, time.time() + respawn_time)
            return True, 0
        else:
            self._ore_hp[key] = current
            return False, current

    def tick_respawns(self) -> list[tuple[int, int, int]]:
        respawned = []
        now = time.time()
        expired = []
        for key, (tile_id, respawn_at) in self._respawn_queue.items():
            if now >= respawn_at:
                wx, wy = key
                current = self._modifications.get(key)
                # Respawn if tile is dirt (mined) — nothing built on it
                if current == DIRT:
                    # Remove the in-memory modification so procedural tile shows
                    del self._modifications[key]
                    respawned.append((wx, wy, tile_id))
                # Also respawn if no modification exists (was already cleaned)
                elif current is None:
                    respawned.append((wx, wy, tile_id))
                # If something else was built there (path, wall), skip respawn
                expired.append(key)
        for key in expired:
            del self._respawn_queue[key]
        return respawned

    def get_chunk(self, cx: int, cy: int) -> Chunk:
        key = (cx, cy)
        if key not in self._chunk_cache:
            self._chunk_cache[key] = self._generate_chunk(cx, cy)
        chunk = self._chunk_cache[key]
        base_x = cx * CHUNK_SIZE
        base_y = cy * CHUNK_SIZE
        has_mods = False
        modified_tiles = [row[:] for row in chunk.tiles]
        for ly in range(CHUNK_SIZE):
            for lx in range(CHUNK_SIZE):
                mod_key = (base_x + lx, base_y + ly)
                if mod_key in self._modifications:
                    modified_tiles[ly][lx] = self._modifications[mod_key]
                    has_mods = True
        if has_mods:
            return Chunk(cx=cx, cy=cy, tiles=modified_tiles)
        return chunk

    def get_tile(self, wx: int, wy: int) -> int:
        mod_key = (wx, wy)
        if mod_key in self._modifications:
            return self._modifications[mod_key]
        cx = wx // CHUNK_SIZE
        cy = wy // CHUNK_SIZE
        lx = wx % CHUNK_SIZE
        ly = wy % CHUNK_SIZE
        chunk = self.get_chunk(cx, cy)
        return chunk.tiles[ly][lx]

    def set_tile(self, wx: int, wy: int, tile_id: int) -> None:
        self._modifications[(wx, wy)] = tile_id

    def is_solid(self, wx: int, wy: int) -> bool:
        tile = self.get_tile(wx, wy)
        return tile in SOLID_TILES

    def _generate_chunk(self, cx: int, cy: int) -> Chunk:
        tiles: list[list[int]] = []
        base_x = cx * CHUNK_SIZE
        base_y = cy * CHUNK_SIZE
        for ly in range(CHUNK_SIZE):
            row: list[int] = []
            for lx in range(CHUNK_SIZE):
                wx = base_x + lx
                wy = base_y + ly
                tile = self._get_tile(wx, wy)
                row.append(tile)
            tiles.append(row)
        return Chunk(cx=cx, cy=cy, tiles=tiles)

    def _get_tile(self, wx: int, wy: int) -> int:
        e_scale = 0.008
        m_scale = 0.012
        o_scale = 0.08
        d_scale = 0.03

        elevation = (
            self._elevation.noise2(wx * e_scale, wy * e_scale) * 0.7
            + self._detail.noise2(wx * d_scale, wy * d_scale) * 0.3
        )
        moisture = self._moisture.noise2(wx * m_scale, wy * m_scale)
        ore = self._ore.noise2(wx * o_scale, wy * o_scale)

        if elevation < -0.45: return DEEP_WATER
        if elevation < -0.25: return WATER
        if elevation < -0.15: return SAND

        if elevation > 0.55:
            if ore > 0.72: return ORE_IRON
            if ore > 0.62: return ORE_COPPER
            if elevation > 0.7: return DENSE_ROCK
            return ROCK

        if moisture > 0.3:
            if moisture > 0.6 and ore > 0.6: return CRYSTAL
            if moisture > 0.45:
                tree_noise = self._detail.noise2(wx * 0.15, wy * 0.15)
                if tree_noise > 0.35: return ALIEN_TREE
                return ALIEN_FLORA
            return ALIEN_GRASS
        if moisture > 0.0:
            tree_noise = self._detail.noise2(wx * 0.15, wy * 0.15)
            if tree_noise > 0.6 and moisture > 0.15: return ALIEN_TREE
            return ALIEN_GRASS
        return DIRT
