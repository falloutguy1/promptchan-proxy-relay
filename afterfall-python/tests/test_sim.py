"""Headless run: the survivor must live, scavenge, fight and build without the simulation erroring."""
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from afterfall.sim import Simulation  # noqa: E402


def run(seed, days, verbose=False):
    sim = Simulation(seed=seed)
    actions = Counter()
    t0 = time.time()
    steps = int(days * 1440 / .1)
    for i in range(steps):
        sim.step(.1)
        s = sim.survivor
        if s.action and i % 10 == 0:
            actions[s.action.name] += 1
    if verbose:
        for e in sim.events:
            print(*e)
    s = sim.survivor
    return {
        "seed": seed, "secs": round(time.time() - t0, 1), "day": sim.day, "gen": sim.generation,
        "built": len(sim.home.built), "alive": s.alive, "loots": s.loots, "kills": s.kills,
        "known": sum(p.known for p in s.memory.places), "actions": dict(actions.most_common(9)),
    }


def test_survivor_builds_and_lives():
    r = run(3, 3)
    assert r["built"] >= 5, r
    assert r["loots"] >= 3, r


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    days = float(sys.argv[2]) if len(sys.argv) > 2 else 5
    print(run(seed, days, verbose="-v" in sys.argv))
