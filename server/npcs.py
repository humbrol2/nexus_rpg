"""NPC animal system — spawning, wandering AI, state management."""

import random
import time
from dataclasses import dataclass, field
from world import SOLID_TILES
from item_registry import ANIMALS

ANIMAL_TYPES = ANIMALS
ANIMALS_PER_CHUNK = 2
MAX_ANIMALS = 200


@dataclass
class Animal:
    id: str
    animal_type: str
    x: float
    y: float
    z: int = 0
    hp: int = 20
    max_hp: int = 20
    spawn_x: float = 0.0
    spawn_y: float = 0.0
    # AI state
    target_x: float | None = None
    target_y: float | None = None
    pause_until: float = 0.0
    last_tick: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.animal_type,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "hp": self.hp,
            "max_hp": self.max_hp,
        }


class NPCManager:
    def __init__(self):
        self._animals: dict[str, Animal] = {}
        self._next_id = 0
        self._spawned_chunks: set[tuple[int, int]] = set()

    def get_all(self) -> list[Animal]:
        return list(self._animals.values())

    def get_nearby(self, px: float, py: float, radius_px: float) -> list[Animal]:
        result = []
        for a in self._animals.values():
            dx = a.x - px
            dy = a.y - py
            if abs(dx) <= radius_px and abs(dy) <= radius_px:
                result.append(a)
        return result

    def spawn_in_chunk(self, cx: int, cy: int, world, chunk_size: int = 64, tile_px: int = 32, cz: int = 0) -> list[Animal]:
        """Spawn animals in a chunk if not already spawned. Returns new animals."""
        if cz != 0:
            return []  # Only spawn animals on surface for now
        key = (cx, cy, cz)
        if key in self._spawned_chunks:
            return []
        if len(self._animals) >= MAX_ANIMALS:
            return []

        self._spawned_chunks.add(key)
        new_animals = []
        base_x = cx * chunk_size
        base_y = cy * chunk_size

        # Find grass tiles in this chunk
        grass_tiles = []
        chunk = world.get_chunk(cx, cy)
        for ly in range(chunk_size):
            for lx in range(chunk_size):
                tile = chunk.tiles[ly][lx]
                if tile in [4, 9]:  # alien_grass, alien_flora
                    grass_tiles.append((base_x + lx, base_y + ly))

        if not grass_tiles:
            return []

        # Spawn a few sheep
        num_spawn = min(ANIMALS_PER_CHUNK, len(grass_tiles) // 20)
        for _ in range(num_spawn):
            if len(self._animals) >= MAX_ANIMALS:
                break
            tx, ty = random.choice(grass_tiles)
            px = tx * tile_px + tile_px // 2
            py = ty * tile_px + tile_px // 2

            self._next_id += 1
            aid = f"npc_{self._next_id}"
            atype = ANIMAL_TYPES["sheep"]

            animal = Animal(
                id=aid,
                animal_type="sheep",
                x=px, y=py,
                hp=atype["max_hp"],
                max_hp=atype["max_hp"],
                spawn_x=px, spawn_y=py,
                pause_until=time.time() + random.uniform(1, 4),
            )
            self._animals[aid] = animal
            new_animals.append(animal)

        return new_animals

    def tick(self, dt: float, world, tile_px: int = 32) -> None:
        """Update all animal AI — wandering."""
        now = time.time()

        for animal in list(self._animals.values()):
            atype = ANIMAL_TYPES.get(animal.animal_type)
            if not atype:
                continue

            # Waiting/paused
            if now < animal.pause_until:
                continue

            # If no target, pick a new wander target
            if animal.target_x is None:
                wander_r = atype["wander_radius"] * tile_px
                animal.target_x = animal.spawn_x + random.uniform(-wander_r, wander_r)
                animal.target_y = animal.spawn_y + random.uniform(-wander_r, wander_r)

            # Move toward target
            dx = animal.target_x - animal.x
            dy = animal.target_y - animal.y
            dist = (dx * dx + dy * dy) ** 0.5

            if dist < 4:
                # Reached target — pause then pick new target
                animal.target_x = None
                animal.target_y = None
                pause_min, pause_max = atype["wander_pause"]
                animal.pause_until = now + random.uniform(pause_min, pause_max)
                continue

            # Move
            speed = atype["speed"] * dt
            if speed > dist:
                speed = dist
            mx = (dx / dist) * speed
            my = (dy / dist) * speed

            new_x = animal.x + mx
            new_y = animal.y + my

            # Simple collision check — don't walk into water/rock
            check_tx = int(new_x // tile_px)
            check_ty = int(new_y // tile_px)
            tile = world.get_tile(check_tx, check_ty)
            if tile in SOLID_TILES or tile == 100 or tile >= 200:
                # Blocked — pick new target
                animal.target_x = None
                animal.target_y = None
                animal.pause_until = now + 1.0
                continue

            animal.x = new_x
            animal.y = new_y
