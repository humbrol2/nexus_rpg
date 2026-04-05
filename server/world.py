"""Procedural world generation using layered simplex noise."""

import time
from dataclasses import dataclass
from opensimplex import OpenSimplex

CHUNK_SIZE = 64

# Tile IDs
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

# Player-placed tiles (100+)
WALL = 100
FLOOR = 101

TILE_NAMES = {
    DEEP_WATER: "deep_water",
    WATER: "water",
    SAND: "sand",
    DIRT: "dirt",
    ALIEN_GRASS: "alien_grass",
    ROCK: "rock",
    DENSE_ROCK: "dense_rock",
    ORE_IRON: "ore_iron",
    ORE_COPPER: "ore_copper",
    ALIEN_FLORA: "alien_flora",
    CRYSTAL: "crystal",
    ALIEN_TREE: "alien_tree",
    WALL: "wall",
    FLOOR: "floor",
}

# Ore HP: how many mines before depletion. Drop per mine action.
# tile_id: (item_name, drop_per_mine, mine_time_seconds, max_hp)
MINABLE_TILES: dict[int, tuple[str, int, float, int]] = {
    ROCK: ("stone", 2, 1.5, 5),
    DENSE_ROCK: ("stone", 3, 2.5, 10),
    ORE_IRON: ("iron_ore", 2, 2.0, 15),
    ORE_COPPER: ("copper_ore", 2, 2.0, 15),
    CRYSTAL: ("crystal", 1, 2.5, 8),
    ALIEN_FLORA: ("biomass", 2, 1.0, 3),
    ALIEN_TREE: ("wood", 3, 2.0, 8),
    WALL: ("stone", 1, 1.0, 1),
}

# Respawn time in seconds per tile type (0 = no respawn)
RESPAWN_TIMES: dict[int, float] = {
    ORE_IRON: 300.0,     # 5 minutes
    ORE_COPPER: 300.0,
    CRYSTAL: 600.0,      # 10 minutes
    ALIEN_TREE: 180.0,   # 3 minutes
    ROCK: 0,             # rocks don't respawn
    DENSE_ROCK: 0,
    ALIEN_FLORA: 120.0,  # 2 minutes
}

# Tiles that block movement
SOLID_TILES = {DEEP_WATER, WATER, DENSE_ROCK, ALIEN_TREE}

# Buildable items: item_name -> (tile_id, cost)
BUILDABLE = {
    "wall": (WALL, {"stone": 3}),
    "floor": (FLOOR, {"stone": 1}),
}


@dataclass
class Chunk:
    cx: int
    cy: int
    tiles: list[list[int]]  # CHUNK_SIZE x CHUNK_SIZE

    def to_flat(self) -> list[int]:
        """Flatten 2D tile array for network transfer."""
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
        # Tile modifications: (world_x, world_y) -> new_tile_id
        self._modifications: dict[tuple[int, int], int] = {}
        # Ore HP tracking: (wx, wy) -> remaining HP
        self._ore_hp: dict[tuple[int, int], int] = {}
        # Respawn queue: (wx, wy) -> (original_tile_id, respawn_at_timestamp)
        self._respawn_queue: dict[tuple[int, int], tuple[int, float]] = {}

    def get_ore_hp(self, wx: int, wy: int) -> int | None:
        """Get remaining HP for an ore tile. Returns None if not tracked (= full HP)."""
        return self._ore_hp.get((wx, wy))

    def get_ore_max_hp(self, tile_id: int) -> int:
        """Get max HP for a tile type."""
        if tile_id in MINABLE_TILES:
            return MINABLE_TILES[tile_id][3]
        return 1

    def damage_ore(self, wx: int, wy: int, tile_id: int) -> tuple[bool, int]:
        """Damage an ore tile by 1 mine action.
        Returns (depleted, current_hp)."""
        key = (wx, wy)
        max_hp = self.get_ore_max_hp(tile_id)
        current = self._ore_hp.get(key, max_hp)
        current -= 1
        if current <= 0:
            # Depleted
            self._ore_hp.pop(key, None)
            # Schedule respawn if applicable
            respawn_time = RESPAWN_TIMES.get(tile_id, 0)
            if respawn_time > 0:
                self._respawn_queue[key] = (tile_id, time.time() + respawn_time)
            return True, 0
        else:
            self._ore_hp[key] = current
            return False, current

    def tick_respawns(self) -> list[tuple[int, int, int]]:
        """Check for tiles ready to respawn. Returns list of (wx, wy, tile_id) that respawned."""
        respawned = []
        now = time.time()
        expired = []

        for key, (tile_id, respawn_at) in self._respawn_queue.items():
            if now >= respawn_at:
                wx, wy = key
                # Only respawn if tile is still dirt (player hasn't built on it)
                current = self._modifications.get(key)
                if current == DIRT:
                    # Remove the modification to reveal original terrain
                    del self._modifications[key]
                    respawned.append((wx, wy, tile_id))
                expired.append(key)

        for key in expired:
            del self._respawn_queue[key]

        return respawned

    def get_chunk(self, cx: int, cy: int) -> Chunk:
        """Get or generate a chunk at chunk coordinates (cx, cy).
        Applies any tile modifications on top of generated terrain."""
        key = (cx, cy)
        if key not in self._chunk_cache:
            self._chunk_cache[key] = self._generate_chunk(cx, cy)

        # Apply modifications to a copy
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
        """Get tile at world tile coordinates, including modifications."""
        mod_key = (wx, wy)
        if mod_key in self._modifications:
            return self._modifications[mod_key]
        cx = wx // CHUNK_SIZE
        cy = wy // CHUNK_SIZE
        lx = wx % CHUNK_SIZE
        ly = wy % CHUNK_SIZE
        chunk = self.get_chunk(cx, cy)
        return chunk.tiles[ly][lx]

    def get_original_tile(self, wx: int, wy: int) -> int:
        """Get the procedurally generated tile, ignoring modifications."""
        return self._get_tile(wx, wy)

    def set_tile(self, wx: int, wy: int, tile_id: int) -> None:
        """Set a tile modification at world coordinates."""
        self._modifications[(wx, wy)] = tile_id

    def is_solid(self, wx: int, wy: int) -> bool:
        """Check if a tile blocks movement."""
        tile = self.get_tile(wx, wy)
        return tile in SOLID_TILES or tile == WALL

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
        o_scale = 0.08   # tighter ore clusters (was 0.05)
        d_scale = 0.03

        elevation = (
            self._elevation.noise2(wx * e_scale, wy * e_scale) * 0.7
            + self._detail.noise2(wx * d_scale, wy * d_scale) * 0.3
        )
        moisture = self._moisture.noise2(wx * m_scale, wy * m_scale)
        ore = self._ore.noise2(wx * o_scale, wy * o_scale)

        if elevation < -0.45:
            return DEEP_WATER
        if elevation < -0.25:
            return WATER
        if elevation < -0.15:
            return SAND

        if elevation > 0.55:
            # Tighter ore thresholds = smaller patches
            if ore > 0.72:       # was 0.65
                return ORE_IRON
            if ore > 0.62:       # was 0.55
                return ORE_COPPER
            if elevation > 0.7:
                return DENSE_ROCK
            return ROCK

        if moisture > 0.3:
            if moisture > 0.6 and ore > 0.6:
                return CRYSTAL
            if moisture > 0.45:
                # Trees scattered in wet areas using detail noise for placement
                tree_noise = self._detail.noise2(wx * 0.15, wy * 0.15)
                if tree_noise > 0.35:
                    return ALIEN_TREE
                return ALIEN_FLORA
            return ALIEN_GRASS
        if moisture > 0.0:
            # Occasional lone trees on drier grass
            tree_noise = self._detail.noise2(wx * 0.15, wy * 0.15)
            if tree_noise > 0.6 and moisture > 0.15:
                return ALIEN_TREE
            return ALIEN_GRASS
        return DIRT
