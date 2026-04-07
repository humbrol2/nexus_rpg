"""Player state management."""

from dataclasses import dataclass, field

from world import CHUNK_SIZE


@dataclass
class Player:
    id: str
    x: float  # world pixel position
    y: float
    z: int = 0  # Z layer (0=surface, -1=underground, etc.)
    speed: float = 200.0  # pixels per second
    name: str = ""
    hp: int = 100
    max_hp: int = 100
    inventory: dict[str, int] = field(default_factory=dict)

    def take_damage(self, amount: int) -> bool:
        """Reduce HP by amount. Returns True if player died."""
        self.hp = max(0, self.hp - amount)
        return self.hp == 0

    def heal(self, amount: int) -> None:
        self.hp = min(self.max_hp, self.hp + amount)

    @property
    def is_dead(self) -> bool:
        return self.hp <= 0

    @property
    def chunk_x(self) -> int:
        return int(self.x // (CHUNK_SIZE * 32))

    @property
    def chunk_y(self) -> int:
        return int(self.y // (CHUNK_SIZE * 32))

    @property
    def chunk_z(self) -> int:
        return self.z

    def add_item(self, item: str, count: int = 1) -> None:
        self.inventory[item] = self.inventory.get(item, 0) + count

    def remove_item(self, item: str, count: int = 1) -> bool:
        current = self.inventory.get(item, 0)
        if current < count:
            return False
        self.inventory[item] = current - count
        if self.inventory[item] == 0:
            del self.inventory[item]
        return True

    def has_items(self, items: dict[str, int]) -> bool:
        return all(self.inventory.get(k, 0) >= v for k, v in items.items())

    def remove_items(self, items: dict[str, int]) -> bool:
        if not self.has_items(items):
            return False
        for k, v in items.items():
            self.remove_item(k, v)
        return True

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "name": self.name,
            "hp": self.hp,
            "max_hp": self.max_hp,
        }

    def inventory_dict(self) -> dict:
        return dict(self.inventory)


class PlayerManager:
    def __init__(self):
        self._players: dict[str, Player] = {}

    def add_player(self, ws_id: str, name: str = "") -> Player:
        player = Player(
            id=ws_id,
            x=CHUNK_SIZE * 32 * 0.5,
            y=CHUNK_SIZE * 32 * 0.5,
            name=name or f"Colonist-{ws_id[:6]}",
        )
        self._players[ws_id] = player
        return player

    def remove_player(self, ws_id: str) -> Player | None:
        return self._players.pop(ws_id, None)

    def get_player(self, ws_id: str) -> Player | None:
        return self._players.get(ws_id)

    def get_all(self) -> list[Player]:
        return list(self._players.values())

    def get_nearby(self, player: Player, chunk_radius: int = 2) -> list[Player]:
        nearby = []
        for p in self._players.values():
            if p.id == player.id:
                continue
            dx = abs(p.chunk_x - player.chunk_x)
            dy = abs(p.chunk_y - player.chunk_y)
            if dx <= chunk_radius and dy <= chunk_radius:
                nearby.append(p)
        return nearby
