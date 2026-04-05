"""Research / Tech tree system."""

from dataclasses import dataclass, field

# Research node definitions
# Each node has a row/col position for the grid layout
RESEARCH_TREE: dict[str, dict] = {
    # Tier 1 — raw materials only (stone, wood, iron_ore, copper_ore)
    "stone_tools": {
        "name": "Stone Tools",
        "desc": "Basic stone construction.",
        "tier": 1, "row": 0, "col": 0,
        "cost": {"stone": 10},
        "time": 15,
        "prereqs": [],
        "unlocks": ["wall", "floor"],
    },
    "basic_smelting": {
        "name": "Smelting",
        "desc": "Unlock Furnace to smelt ore.",
        "tier": 1, "row": 1, "col": 0,
        "cost": {"stone": 15, "iron_ore": 8},
        "time": 25,
        "prereqs": [],
        "unlocks": ["furnace"],
    },
    "woodworking": {
        "name": "Woodworking",
        "desc": "Process wood for building.",
        "tier": 1, "row": 2, "col": 0,
        "cost": {"wood": 10, "stone": 5},
        "time": 20,
        "prereqs": [],
        "unlocks": ["planks_recipe"],
    },
    "prospecting": {
        "name": "Prospecting",
        "desc": "Improved ore detection range.",
        "tier": 1, "row": 3, "col": 0,
        "cost": {"stone": 8, "copper_ore": 5},
        "time": 20,
        "prereqs": [],
        "unlocks": ["ore_detection"],
    },

    # Tier 2 — requires tier 1, uses raw + basic processed
    "storage_tech": {
        "name": "Storage",
        "desc": "Unlock Storage Crates.",
        "tier": 2, "row": 0, "col": 1,
        "cost": {"stone": 15, "wood": 10},
        "time": 20,
        "prereqs": ["stone_tools"],
        "unlocks": ["storage_crate"],
    },
    "basic_automation": {
        "name": "Automation",
        "desc": "Unlock Auto-Miner.",
        "tier": 2, "row": 1, "col": 1,
        "cost": {"stone": 20, "iron_ore": 10},
        "time": 30,
        "prereqs": ["basic_smelting"],
        "unlocks": ["auto_miner"],
    },
    "fortification": {
        "name": "Fortification",
        "desc": "Reinforced walls (3x HP).",
        "tier": 2, "row": 2, "col": 1,
        "cost": {"wood": 15, "stone": 15},
        "time": 30,
        "prereqs": ["woodworking", "stone_tools"],
        "unlocks": ["reinforced_wall"],
    },
    "improved_mining": {
        "name": "Better Mining",
        "desc": "+1 drop per mine swing.",
        "tier": 2, "row": 3, "col": 1,
        "cost": {"stone": 20, "iron_ore": 8},
        "time": 25,
        "prereqs": ["prospecting"],
        "unlocks": ["mining_bonus"],
    },

    # Tier 3 — requires tier 2
    "fabrication": {
        "name": "Fabrication",
        "desc": "Unlock Fabricator for gears.",
        "tier": 3, "row": 0, "col": 2,
        "cost": {"iron_plate": 8, "copper_plate": 5},
        "time": 45,
        "prereqs": ["basic_automation", "basic_smelting"],
        "unlocks": ["fabricator"],
    },
    "advanced_smelting": {
        "name": "Adv. Smelting",
        "desc": "Furnaces smelt 2x faster.",
        "tier": 3, "row": 1, "col": 2,
        "cost": {"iron_plate": 10, "stone": 20},
        "time": 50,
        "prereqs": ["basic_automation"],
        "unlocks": ["fast_furnace"],
    },
    "construction": {
        "name": "Construction",
        "desc": "Advanced building techniques.",
        "tier": 3, "row": 2, "col": 2,
        "cost": {"iron_plate": 5, "wood": 20},
        "time": 40,
        "prereqs": ["fortification"],
        "unlocks": ["advanced_building"],
    },

    # Tier 4 — late game
    "electronics": {
        "name": "Electronics",
        "desc": "Circuits and components.",
        "tier": 4, "row": 0, "col": 3,
        "cost": {"circuit": 5, "iron_gear": 5, "crystal": 3},
        "time": 90,
        "prereqs": ["fabrication"],
        "unlocks": ["electronics"],
    },
    "solar_power": {
        "name": "Solar Power",
        "desc": "Unlock solar panels.",
        "tier": 4, "row": 1, "col": 3,
        "cost": {"copper_plate": 10, "crystal": 5},
        "time": 75,
        "prereqs": ["fabrication", "advanced_smelting"],
        "unlocks": ["solar_panel"],
    },
    "deep_mining": {
        "name": "Deep Mining",
        "desc": "Miners extract 2x resources.",
        "tier": 4, "row": 2, "col": 3,
        "cost": {"iron_gear": 8, "stone": 30},
        "time": 80,
        "prereqs": ["improved_mining", "fabrication"],
        "unlocks": ["deep_mining"],
    },
}


@dataclass
class PlayerResearch:
    """Tracks a single player's research progress."""
    completed: set[str] = field(default_factory=set)
    active: str | None = None
    progress: float = 0.0

    def is_completed(self, research_id: str) -> bool:
        return research_id in self.completed

    def can_research(self, research_id: str) -> bool:
        if research_id not in RESEARCH_TREE:
            return False
        if research_id in self.completed:
            return False
        if self.active is not None:
            return False
        node = RESEARCH_TREE[research_id]
        return all(p in self.completed for p in node["prereqs"])

    def start_research(self, research_id: str) -> bool:
        if not self.can_research(research_id):
            return False
        self.active = research_id
        self.progress = 0.0
        return True

    def tick(self, dt: float) -> str | None:
        if not self.active:
            return None
        node = RESEARCH_TREE[self.active]
        self.progress += dt
        if self.progress >= node["time"]:
            completed_id = self.active
            self.completed.add(completed_id)
            self.active = None
            self.progress = 0.0
            return completed_id
        return None

    def cancel(self) -> None:
        self.active = None
        self.progress = 0.0

    def to_dict(self) -> dict:
        return {
            "completed": list(self.completed),
            "active": self.active,
            "progress": self.progress,
        }

    @staticmethod
    def from_dict(data: dict) -> "PlayerResearch":
        pr = PlayerResearch()
        pr.completed = set(data.get("completed", []))
        pr.active = data.get("active")
        pr.progress = data.get("progress", 0.0)
        return pr


def get_tree_for_client() -> dict:
    result = {}
    for rid, node in RESEARCH_TREE.items():
        result[rid] = {
            "name": node["name"],
            "desc": node["desc"],
            "tier": node["tier"],
            "row": node["row"],
            "col": node["col"],
            "cost": node["cost"],
            "time": node["time"],
            "prereqs": node["prereqs"],
            "unlocks": node["unlocks"],
        }
    return result
