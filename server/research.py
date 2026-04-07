"""Research / Tech tree system."""

from dataclasses import dataclass, field

RESEARCH_TREE: dict[str, dict] = {
    # Tier 1 — raw materials
    "stone_tools": {
        "name": "Stone Tools",
        "desc": "Unlock walls, paths, and wood/stone chests.",
        "tier": 1, "row": 0, "col": 0,
        "cost": {"stone": 10},
        "time": 15,
        "prereqs": [],
        "unlocks": ["wall", "floor", "wood_chest", "stone_chest"],
    },
    "stone_walls": {
        "name": "Stone Walls",
        "desc": "Unlock stone walls for base defense.",
        "tier": 1, "row": 1, "col": 0,
        "cost": {"stone": 10},
        "time": 15,
        "prereqs": [],
        "unlocks": ["wall"],
    },
    "stone_paths": {
        "name": "Stone Paths",
        "desc": "Unlock stone paths (+15% walk speed).",
        "tier": 1, "row": 2, "col": 0,
        "cost": {"stone": 10},
        "time": 15,
        "prereqs": [],
        "unlocks": ["floor"],
    },

    "homestead": {
        "name": "Homestead",
        "desc": "Unlock claim flags to protect 25x25 land areas. Max 5 claims.",
        "tier": 1, "row": 3, "col": 0,
        "cost": {"stone": 10, "wood": 10},
        "time": 20,
        "prereqs": [],
        "unlocks": ["claim_flag"],
    },

    "farming": {
        "name": "Farming",
        "desc": "Unlock farm plots to grow wheat. Harvest alien flora for seeds.",
        "tier": 1, "row": 5, "col": 0,
        "cost": {"biomass": 10, "wood": 5},
        "time": 20,
        "prereqs": ["stone_tools"],
        "unlocks": ["farm_plot"],
    },

    "underground": {
        "name": "Underground Access",
        "desc": "Unlock stairs to descend into caves and return to the surface.",
        "tier": 1, "row": 4, "col": 0,
        "cost": {"stone": 15, "wood": 10},
        "time": 20,
        "prereqs": ["stone_tools"],
        "unlocks": ["stairs_down", "stairs_up"],
    },

    # Tier 2 — requires stone tools
    "smelting": {
        "name": "Smelting",
        "desc": "Unlock stone furnace to smelt ore into plates. Unlocks copper/iron chests.",
        "tier": 2, "row": 0, "col": 1,
        "cost": {"stone": 15, "iron_ore": 10},
        "time": 30,
        "prereqs": ["stone_tools"],
        "unlocks": ["furnace", "copper_chest", "iron_chest"],
    },
}


@dataclass
class PlayerResearch:
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
