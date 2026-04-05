"""Machine system — auto-miners, fabricators, storage containers."""

from dataclasses import dataclass, field
import time

from item_registry import MACHINES, MACHINE_RECIPES, MINABLE

CHUNK_SIZE = 64

# Derive from registry
MACHINE_NAMES = {k: v["name"] for k, v in MACHINES.items()}
MACHINE_COSTS = {k: v["cost"] for k, v in MACHINES.items()}
MACHINE_MAX_STORAGE = {k: v.get("max_storage", 50) for k, v in MACHINES.items()}

# Machine type shortcuts
MACHINE_MINER = 200
MACHINE_FABRICATOR = 201
MACHINE_STORAGE = 202
MACHINE_FURNACE = 203

# Convert MACHINE_RECIPES to old tuple format for compatibility
RECIPES = {}
for output, recipe in MACHINE_RECIPES.items():
    RECIPES[output] = (recipe["inputs"], recipe["time"], recipe["machine"])

# What auto-miners can extract from adjacent tiles (from MINABLE registry)
MINER_YIELDS = {}
for tile_id, info in MINABLE.items():
    if tile_id in (7, 8, 10, 5):  # ores, crystal, rock
        MINER_YIELDS[tile_id] = (info["item"], 1)


@dataclass
class Machine:
    machine_id: str
    machine_type: int
    wx: int
    wy: int
    owner_id: str
    inventory: dict[str, int] = field(default_factory=dict)
    output: dict[str, int] = field(default_factory=dict)
    recipe: str | None = None
    craft_progress: float = 0.0
    last_tick: float = field(default_factory=time.time)
    max_storage: int = 50

    @property
    def name(self) -> str:
        return MACHINE_NAMES.get(self.machine_type, "Unknown")

    def input_count(self) -> int:
        return sum(self.inventory.values())

    def output_count(self) -> int:
        return sum(self.output.values())

    def total_items(self) -> int:
        return self.input_count() + self.output_count()

    def add_input(self, item: str, count: int = 1) -> int:
        space = self.max_storage - self.total_items()
        actual = min(count, space)
        if actual > 0:
            self.inventory[item] = self.inventory.get(item, 0) + actual
        return actual

    def take_output(self, item: str, count: int = 1) -> int:
        available = self.output.get(item, 0)
        actual = min(count, available)
        if actual > 0:
            self.output[item] = available - actual
            if self.output[item] == 0:
                del self.output[item]
        return actual

    def take_all_output(self) -> dict[str, int]:
        items = dict(self.output)
        self.output.clear()
        return items

    def to_dict(self) -> dict:
        return {
            "machine_id": self.machine_id,
            "machine_type": self.machine_type,
            "name": self.name,
            "wx": self.wx,
            "wy": self.wy,
            "owner_id": self.owner_id,
            "inventory": dict(self.inventory),
            "output": dict(self.output),
            "recipe": self.recipe,
            "craft_progress": self.craft_progress,
            "max_storage": self.max_storage,
        }


class MachineManager:
    def __init__(self):
        self._machines: dict[str, Machine] = {}
        self._by_pos: dict[tuple[int, int], str] = {}
        self._next_id = 0

    def place(self, machine_type: int, wx: int, wy: int, owner_id: str) -> Machine:
        self._next_id += 1
        mid = f"m_{self._next_id}"
        max_stor = MACHINE_MAX_STORAGE.get(machine_type, 50)
        machine = Machine(machine_id=mid, machine_type=machine_type, wx=wx, wy=wy, owner_id=owner_id, max_storage=max_stor)
        self._machines[mid] = machine
        self._by_pos[(wx, wy)] = mid
        return machine

    def remove(self, wx: int, wy: int) -> Machine | None:
        mid = self._by_pos.pop((wx, wy), None)
        if mid:
            return self._machines.pop(mid, None)
        return None

    def get_at(self, wx: int, wy: int) -> Machine | None:
        mid = self._by_pos.get((wx, wy))
        if mid:
            return self._machines.get(mid)
        return None

    def get_all(self) -> list[Machine]:
        return list(self._machines.values())

    def get_in_chunk(self, cx: int, cy: int) -> list[Machine]:
        machines = []
        base_x = cx * CHUNK_SIZE
        base_y = cy * CHUNK_SIZE
        for m in self._machines.values():
            if base_x <= m.wx < base_x + CHUNK_SIZE and base_y <= m.wy < base_y + CHUNK_SIZE:
                machines.append(m)
        return machines

    def tick(self, dt: float, world) -> list[dict]:
        events = []
        now = time.time()
        for machine in self._machines.values():
            elapsed = now - machine.last_tick
            machine.last_tick = now
            if machine.machine_type == MACHINE_MINER:
                events.extend(self._tick_miner(machine, elapsed, world))
            elif machine.machine_type in (MACHINE_FABRICATOR, MACHINE_FURNACE):
                events.extend(self._tick_crafter(machine, elapsed))
        return events

    def _tick_miner(self, machine: Machine, dt: float, world) -> list[dict]:
        events = []
        if machine.total_items() >= machine.max_storage:
            return events
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            adj_x = machine.wx + dx
            adj_y = machine.wy + dy
            tile = world.get_tile(adj_x, adj_y)
            if tile in MINER_YIELDS:
                item, count = MINER_YIELDS[tile]
                machine.craft_progress += dt
                if machine.craft_progress >= 3.0:
                    machine.craft_progress -= 3.0
                    added = machine.add_input(item, count)
                    if added > 0:
                        machine.output[item] = machine.output.get(item, 0) + added
                        machine.inventory[item] = machine.inventory.get(item, 0) - added
                        if machine.inventory[item] <= 0:
                            del machine.inventory[item]
                        events.append({"type": "machine_produce", "machine_id": machine.machine_id, "item": item, "count": added})
                break
        return events

    def _tick_crafter(self, machine: Machine, dt: float) -> list[dict]:
        events = []
        if not machine.recipe or machine.recipe not in RECIPES:
            return events
        inputs, craft_time, required_type = RECIPES[machine.recipe]
        if machine.machine_type != required_type:
            return events
        if machine.total_items() >= machine.max_storage:
            return events
        has_inputs = all(machine.inventory.get(item, 0) >= count for item, count in inputs.items())
        if not has_inputs:
            return events
        machine.craft_progress += dt
        if machine.craft_progress >= craft_time:
            machine.craft_progress -= craft_time
            for item, count in inputs.items():
                machine.inventory[item] -= count
                if machine.inventory[item] <= 0:
                    del machine.inventory[item]
            machine.output[machine.recipe] = machine.output.get(machine.recipe, 0) + 1
            events.append({"type": "machine_produce", "machine_id": machine.machine_id, "item": machine.recipe, "count": 1})
        return events
