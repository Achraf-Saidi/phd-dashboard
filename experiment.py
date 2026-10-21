"""Expérience 01 : calibration à horizon fixe et censure indépendante."""

from dataclasses import asdict, dataclass
import json
from pathlib import Path
import numpy as np


@dataclass(frozen=True)
class Config:
    n: int = 3000
    history: int = 120
    g: float = 0.70
    repetitions: int = 500
    seed: int = 20261021
    tau: float = 12.0

    def __post_init__(self):
        for name, low, high in [("n", 100, 10000), ("history", 20, 10000),
                                ("repetitions", 20, 2000), ("seed", 0, 2**32-1)]:
            value = getattr(self, name)
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"{name} doit être un entier entre {low} et {high}.")
        if not 0.1 <= self.g <= 1 or not np.isfinite(self.tau) or self.tau <= 0:
            raise ValueError("Il faut 0.1 ≤ G ≤ 1 et un horizon strictement positif.")


ALPHA = 0.05
METHODS = ("full", "naive", "oracle", "plugin")
BETS = np.array([-.8, -.4, -.2, -.1, -.05, .05, .1, .2, .4, .8])


def generate(rng, size, g, tau):
    x = rng.uniform(-1, 1, size)
    p = 1 / (1 + np.exp(-(.5 + 1.2 * x)))
    t = rng.exponential(tau / -np.log(p))
    c = rng.exponential(tau / -np.log(g), size) if g < 1 else np.full(size, np.inf)
    return x, p, t, c


def reverse_km(time, event, tau):
    """KM de C : les censures originales deviennent les événements de KM.

    Générateur continu : pas d'ex aequo événement/censure. Pas d'extrapolation.
    """
    order = np.argsort(time)
    time, event = np.asarray(time)[order], np.asarray(event)[order]
    if time[-1] < tau:
        return None
    times, first = np.unique(time, return_index=True)
    deaths = np.add.reduceat((~event.astype(bool)).astype(int), first)
    at_risk = len(time) - first
    ghat = float(np.prod(1 - deaths[times <= tau] / at_risk[times <= tau]))
    return ghat if ghat > 0 else None


def log_e_process(residual):
    """E_n = moyenne_b produit_{i≤n}(1 + b * residual_i), E_0 = 1.

    residual ∈ [-1,1]. Le calcul logarithmique évite les débordements.
    """
    log_wealth = np.cumsum(np.log1p(np.asarray(residual)[:, None] * BETS), axis=0)
    return np.logaddexp.reduce(log_wealth, axis=1) - np.log(len(BETS))


def one_run(cfg, repetition=0, stream=0):
    # Flux séparés : changer la taille historique conserve les patients évalués.
    history_rng = np.random.default_rng(np.random.SeedSequence([cfg.seed, stream, repetition, 0]))
    patient_rng = np.random.default_rng(np.random.SeedSequence([cfg.seed, stream, repetition, 1]))
    _, _, ht, hc = generate(history_rng, cfg.history, cfg.g, cfg.tau)
    ghat = reverse_km(np.minimum(ht, hc), ht <= hc, cfg.tau)
    x, p, t, c = generate(patient_rng, cfg.n, cfg.g, cfg.tau)
    y = (t > cfg.tau).astype(float)
    r = (np.minimum(t, c) > cfg.tau).astype(float)
    observed_event = (t <= c) & (t <= cfg.tau)
    unknown = (c < t) & (c <= cfg.tau)
    methods = {}
    for name, outcome, denominator in [("full", y, 1.), ("naive", r, 1.),
                                       ("oracle", r, cfg.g), ("plugin", r, ghat)]:
        if denominator is None:
            methods[name] = None
            continue
        z = outcome / denominator - p
        expected = np.zeros(cfg.n) if name == "full" else p * (cfg.g / denominator - 1)
        log_e = log_e_process(outcome - denominator * p)
        crossings = np.flatnonzero(log_e >= np.log(1 / ALPHA))
        methods[name] = {"score": z, "expected": expected, "log_e": log_e,
                         "first_alert": int(crossings[0] + 1) if crossings.size else None}
    return {"x": x, "p": p, "t": t, "c": c, "y": y, "r": r,
            "observed_event": observed_event, "unknown": unknown,
            "ghat": ghat, "methods": methods}


def wilson_interval(successes, total):
    """Intervalle de Wilson à 95 % pour une fréquence Monte-Carlo."""
    if total == 0:
        return [None, None]
    z = 1.959963984540054
    p = successes / total
    center = (p + z*z / (2*total)) / (1 + z*z/total)
    radius = z * np.sqrt(p*(1-p)/total + z*z/(4*total*total)) / (1 + z*z/total)
    return [max(0., float(center-radius)), min(1., float(center+radius))]


def trajectory(cfg):
    run = one_run(cfg)
    n = np.arange(1, cfg.n + 1)
    out = {"config": asdict(cfg), "alpha": ALPHA, "ghat": run["ghat"],
           "n": n.tolist(), "methods": {}, "bins": [], "patients": [],
           "counts": {"survival": int(run["r"].sum()),
                      "event": int(run["observed_event"].sum()),
                      "unknown": int(run["unknown"].sum())}}
    for name, m in run["methods"].items():
        out["methods"][name] = None if m is None else {
            "mean": float(m["score"].mean()), "expected_mean": float(m["expected"].mean()),
            "running_mean": (np.cumsum(m["score"])/n).tolist(),
            "expected_running_mean": (np.cumsum(m["expected"])/n).tolist(),
            "log10_e": (m["log_e"]/np.log(10)).tolist(), "first_alert": m["first_alert"]}
    # Tranches de risque descriptives, sans test ou bande de confiance supplémentaire.
    for idx in np.array_split(np.argsort(run["p"]), 6):
        row = {"p": float(run["p"][idx].mean()), "count": len(idx)}
        for name, m in run["methods"].items():
            row[name] = None if m is None else float((m["score"][idx]+run["p"][idx]).mean())
        out["bins"].append(row)
    for i in range(cfg.n):
        out["patients"].append({"i": i+1, "x": float(run["x"][i]), "p": float(run["p"][i]),
            "t": float(run["t"][i]), "c": float(run["c"][i]) if np.isfinite(run["c"][i]) else None,
            "observed_time": float(min(run["t"][i], run["c"][i])),
            "delta": int(run["t"][i] <= run["c"][i]), "y": int(run["y"][i]),
            "r": int(run["r"][i]), "unknown": bool(run["unknown"][i])})
    return out


def monte_carlo(cfg, progress=None):
    rows = []
    for rep in range(cfg.repetitions):
        run = one_run(cfg, repetition=rep, stream=1)
        row = {"repetition": rep+1, "ghat": run["ghat"]}
        for name, m in run["methods"].items():
            row[name] = None if m is None else {"first_alert": m["first_alert"],
                "mean": float(m["score"].mean()), "expected_mean": float(m["expected"].mean())}
        rows.append(row)
        if progress and ((rep+1) % 10 == 0 or rep+1 == cfg.repetitions):
            progress(rep+1, cfg.repetitions)
    summary = {}
    for name in METHODS:
        available = [r[name] for r in rows if r[name] is not None]
        count = sum(r["first_alert"] is not None for r in available)
        summary[name] = {"alerts": count, "valid_runs": len(available),
            "unavailable_runs": cfg.repetitions-len(available),
            "rate": count/len(available) if available else None,
            "interval": wilson_interval(count, len(available)),
            "mean_score": float(np.mean([r["mean"] for r in available])) if available else None}
    return {"config": asdict(cfg), "alpha": ALPHA, "summary": summary, "runs": rows}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=3000)
    parser.add_argument("--history", type=int, default=120)
    parser.add_argument("--g", type=float, default=.70)
    parser.add_argument("--repetitions", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--output", type=Path, default=Path("results/experiment_01.json"))
    args = parser.parse_args()
    cfg = Config(**{k:v for k,v in vars(args).items() if k != "output"})
    result = {"trajectory": trajectory(cfg), "monte_carlo": monte_carlo(cfg),
              "numpy_version": np.__version__}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(result["monte_carlo"]["summary"], indent=2))
    print(f"Résultats : {args.output}")
