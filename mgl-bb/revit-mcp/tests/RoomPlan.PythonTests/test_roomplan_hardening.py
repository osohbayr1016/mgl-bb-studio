"""Room Plan hardening (2026-10-14 audit): every confirmed defect gets a regression test.

No Revit, AI, internet or pip.  Each test names the audit finding it pins.
"""
import copy
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PY = Path(__file__).resolve().parents[2] / "addin" / "RoomPlan" / "Python"
CLI = PY / "roomplan_cli.py"
sys.path.insert(0, str(PY))
from plan_validation import validate_plan  # noqa: E402

HALL = "Хонгил"
CORRIDOR_TOPOLOGIES = {"t-hall", "l-hall", "central-hall", "side-hall"}


class RoomPlanHardeningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "prefs.sqlite3"
        self.env = dict(os.environ, MGL_ROOMPLAN_DB_PATH=str(self.db))

    def call(self, data, ok=True, raw=None):
        payload = raw if raw is not None else json.dumps(data, ensure_ascii=False).encode("utf-8")
        result = subprocess.run([sys.executable, str(CLI)], input=payload, capture_output=True,
                                env=self.env, timeout=30)
        response = json.loads(result.stdout.decode("utf-8"))
        if ok:
            self.assertEqual(result.returncode, 0, (response, result.stderr.decode("utf-8", "replace")))
        else:
            self.assertNotEqual(result.returncode, 0)
        return response

    def unit(self, **kw):
        base = dict(unit_id="u1", width_m=12, height_m=11, bedrooms=2, entry="south")
        base.update(kw)
        return base

    def one_option(self):
        out = self.call({"command": "generate_batch", "units": [self.unit()]})
        return out["units"][0]["options"][0]

    # ---- P1-a: a corridor narrower than 1.36 m used to drop EVERY corridor plan
    def test_narrow_hall_request_still_yields_corridor_plans_and_says_so(self):
        out = self.call({"command": "generate_batch",
                         "units": [self.unit(width_m=10, height_m=10, hall_width=1.2)]})
        u = out["units"][0]
        self.assertEqual(u["hall_width_requested"], 1.2)
        self.assertEqual(u["hall_width_used"], 1.4)
        self.assertTrue(any("1.40" in w for w in u["warnings"]), u["warnings"])
        generated = [o for o in u["options"] if o["template"].startswith("gen-")
                     and o["topology"] in CORRIDOR_TOPOLOGIES]
        self.assertTrue(generated, "corridor plans must not silently vanish at 1.2 m")
        self.assertGreater(u["options"][0]["score"], 80.0)

    def test_requested_width_at_or_above_minimum_is_used_unchanged(self):
        out = self.call({"command": "generate_batch", "units": [self.unit(hall_width=1.6)]})
        u = out["units"][0]
        self.assertEqual(u["hall_width_used"], 1.6)
        self.assertFalse(any("хонгилтой хувилбаруудыг" in w for w in u["warnings"]))
        for o in u["options"]:
            for r in o["rooms"]:
                if r["name"] == HALL:
                    self.assertGreaterEqual(min(r["x2"] - r["x1"], r["y2"] - r["y1"]), 1.6 - 1e-3)

    # ---- P1-b: a saved (non-uniformly scaled) plan could come back with a 1.09 m corridor
    def test_reused_plan_never_narrower_than_requested_corridor(self):
        first = self.call({"command": "generate_batch", "batch_id": "saved-src-1",
                           "units": [self.unit(width_m=14, height_m=14, hall_width=1.4)]})
        hallish = [o for o in first["units"][0]["options"]
                   if any(r["name"] == HALL for r in o["rooms"])]
        self.assertTrue(hallish)
        for o in hallish[:6]:
            self.call({"command": "record_event", "batch_id": "saved-src-1", "unit_id": "u1",
                       "option_id": o["option_id"], "action": "applied"})
        out = self.call({"command": "generate_batch", "batch_id": "saved-dst-1",
                         "units": [self.unit(width_m=14, height_m=10.92, hall_width=1.4)]})
        for o in out["units"][0]["options"]:
            for r in o["rooms"]:
                if r["name"] == HALL:
                    self.assertGreaterEqual(min(r["x2"] - r["x1"], r["y2"] - r["y1"]), 1.4 - 1e-3,
                                            (o["template"], r))

    # ---- P2-a: mirror pass emitted identical geometry under different wall ids
    def test_gallery_has_no_geometric_duplicates(self):
        out = self.call({"command": "generate_batch", "units": [self.unit(
            width_m=26.6, height_m=9.9, bedrooms=4, bathrooms=1, entry="west",
            facades=["south", "west", "east"], hall_width=1.2)]})
        keys = []
        for o in out["units"][0]["options"]:
            rooms = sorted((r["name"][:4], round(r["x1"], 3), round(r["y1"], 3),
                            round(r["x2"], 3), round(r["y2"], 3)) for r in o["rooms"])
            doors = sorted((round(d["center"]["x"], 3), round(d["center"]["y"], 3)) for d in o["doors"])
            keys.append(json.dumps([rooms, doors], ensure_ascii=False))
        self.assertEqual(len(keys), len(set(keys)))

    # ---- P2-b: validator holes (accepted corrupt plans; NaN crashed json.dumps for the batch)
    def test_validator_rejects_structural_corruption(self):
        o = self.one_option()
        w, h = o["width_m"], o["height_m"]
        ok, why, _ = validate_plan(w, h, o["walls"], o["rooms"], o["doors"], entry="south", min_hall=1.4)
        self.assertTrue(ok, why)

        def bad(mutate, expect):
            walls, rooms, doors = copy.deepcopy(o["walls"]), copy.deepcopy(o["rooms"]), copy.deepcopy(o["doors"])
            entry, ww, hh = mutate(walls, rooms, doors)
            ok2, why2, _ = validate_plan(ww or w, hh or h, walls, rooms, doors, entry=entry or "south")
            self.assertFalse(ok2, expect)
            self.assertIn(expect, why2)

        living = next(r for r in o["rooms"] if r["name"].startswith("Зочны"))
        mid = round((living["x1"] + living["x2"]) / 2, 3)

        def split_living(walls, rooms, doors):
            walls.append({"id": "wx", "start": {"x": mid, "y": living["y1"]}, "end": {"x": mid, "y": living["y2"]}})
            return None, None, None
        bad(split_living, "wall cuts through a room")

        def diagonal(walls, rooms, doors):
            walls.append({"id": "wd", "start": {"x": 0, "y": 0}, "end": {"x": w, "y": h}})
            return None, None, None
        bad(diagonal, "diagonal wall")

        def zero_length(walls, rooms, doors):
            walls.append({"id": "wz", "start": {"x": 1, "y": 1}, "end": {"x": 1, "y": 1}})
            return None, None, None
        bad(zero_length, "zero-length wall")

        def outside(walls, rooms, doors):
            walls.append({"id": "wo", "start": {"x": 50, "y": 0}, "end": {"x": 50, "y": 3}})
            return None, None, None
        bad(outside, "wall outside footprint")

        def missing_partition(walls, rooms, doors):
            interior = [x for x in walls if x["id"] not in ("south", "north", "west", "east")]
            walls.remove(next(x for x in interior if not any(d["host_wall"] == x["id"] for d in doors)))
            return None, None, None
        bad(missing_partition, "shared edge between rooms has no wall")

        def wrong_side(walls, rooms, doors):
            return "north", None, None
        bad(wrong_side, "outside entry is not on the requested side")

        def dup_names(walls, rooms, doors):
            beds = [r for r in rooms if r["name"].startswith("Унтлагын")]
            beds[1]["name"] = beds[0]["name"]
            return None, None, None
        bad(dup_names, "duplicate room names")

        def nan_room(walls, rooms, doors):
            rooms[0]["x2"] = float("nan")
            return None, None, None
        bad(nan_room, "finite")

        def perimeter(walls, rooms, doors):
            east = next(x for x in walls if x["id"] == "east")
            east["end"] = {"x": east["end"]["x"], "y": east["end"]["y"] / 2}
            return None, None, None
        bad(perimeter, "perimeter")

        ok3, why3, _ = validate_plan(w, h, o["walls"], [{"name": "A"}], o["doors"])
        self.assertFalse(ok3)
        self.assertIn("malformed", why3)
        ok4, why4, _ = validate_plan(w, h, o["walls"], [{"oops": 1}], o["doors"])
        self.assertFalse(ok4)
        self.assertIn("name missing", why4)

    def test_corridor_minimum_is_enforced_when_requested(self):
        o = next(x for x in self.call({"command": "generate_batch", "units": [self.unit(hall_width=1.4)]})
                 ["units"][0]["options"] if any(r["name"] == HALL for r in x["rooms"]))
        ok, why, _ = validate_plan(o["width_m"], o["height_m"], o["walls"], o["rooms"], o["doors"], min_hall=1.6)
        self.assertFalse(ok)
        self.assertIn("corridor narrower", why)

    # ---- P2-c: the preference DB was a hard dependency of generation
    def test_corrupt_preferences_db_does_not_block_generation(self):
        self.db.write_bytes(b"this is not a sqlite database at all" * 20)
        out = self.call({"command": "generate_batch", "units": [self.unit()]})
        u = out["units"][0]
        self.assertGreater(len(u["options"]), 2)
        self.assertTrue(any("эвдэрсэн" in w for w in u["warnings"]), u["warnings"])
        archived = [p.name for p in self.db.parent.iterdir() if ".corrupt-" in p.name]
        self.assertEqual(len(archived), 1, "corrupt file is kept aside, never deleted")
        self.assertTrue(out["recorded"])
        self.assertGreater(self.call({"command": "analytics"})["generated"], 0)

    def test_unusable_db_path_degrades_to_history_free_generation(self):
        blocker = Path(self.tmp.name) / "blocker"
        blocker.write_text("x", encoding="utf-8")
        self.env = dict(os.environ, MGL_ROOMPLAN_DB_PATH=str(blocker / "sub" / "prefs.sqlite3"))
        try:
            out = self.call({"command": "generate_batch", "units": [self.unit()]})
        except AssertionError:
            # mkdir under a FILE raises OSError before sqlite — must still not crash generation
            raise
        u = out["units"][0]
        self.assertGreater(len(u["options"]), 2)
        self.assertFalse(out["recorded"])
        self.assertTrue(out["warnings"])

    def test_reset_preferences_archives_instead_of_deleting(self):
        self.call({"command": "generate_batch", "units": [self.unit()]})
        self.assertGreater(self.call({"command": "analytics"})["generated"], 0)
        res = self.call({"command": "reset_preferences"})
        self.assertTrue(res["ok"])
        self.assertIn(".reset-", res["archived_as"])
        self.assertEqual(self.call({"command": "analytics"})["generated"], 0)

    def test_old_undecided_proposals_are_pruned_but_decided_ones_kept(self):
        import sqlite3
        out = self.call({"command": "generate_batch", "batch_id": "old-batch-1", "units": [self.unit()]})
        opts = out["units"][0]["options"]
        self.call({"command": "record_event", "batch_id": "old-batch-1", "unit_id": "u1",
                   "option_id": opts[0]["option_id"], "action": "rejected", "reason": "too_small"})
        con = sqlite3.connect(str(self.db))
        con.execute("UPDATE proposals SET created_utc='2026-01-01T00:00:00+00:00'")
        con.commit()
        con.close()
        self.call({"command": "generate_batch", "batch_id": "new-batch-2", "units": [self.unit(unit_id="u2")]})
        con = sqlite3.connect(str(self.db))
        old = con.execute("SELECT option_id FROM proposals WHERE batch_id='old-batch-1'").fetchall()
        con.close()
        self.assertEqual([r[0] for r in old], [opts[0]["option_id"]], "only the decided proposal survives")

    # ---- P2-h: a UTF-8 BOM on stdin (net48 StandardInput) used to fail json.load
    def test_utf8_bom_on_stdin_is_accepted(self):
        payload = b"\xef\xbb\xbf" + json.dumps({"command": "health"}).encode("utf-8")
        out = self.call(None, raw=payload)
        self.assertTrue(out["ok"])

    # ---- P3: TypeError in one unit killed the batch; terse English keys reached the architect
    def test_malformed_unit_fields_are_unit_errors_in_mongolian(self):
        out = self.call({"command": "generate_batch", "units": [
            self.unit(unit_id="good"),
            self.unit(unit_id="facade", facades=[["south"]]),
            self.unit(unit_id="narrow", width_m=6.5),
            self.unit(unit_id="hallbad", hall_width="wide"),
        ]})
        good, facade, narrow, hallbad = out["units"]
        self.assertGreater(len(good["options"]), 2)
        self.assertIn("фасад", facade["error"])
        self.assertIn("Нэгжийн өргөн", narrow["error"])
        self.assertIn("6.5", narrow["error"])
        self.assertIn("Хонгилын өргөн", hallbad["error"])

    def test_rejection_after_applied_is_refused(self):
        out = self.call({"command": "generate_batch", "batch_id": "final-batch-1", "units": [self.unit()]})
        oid = out["units"][0]["options"][0]["option_id"]
        self.call({"command": "record_event", "batch_id": "final-batch-1", "unit_id": "u1",
                   "option_id": oid, "action": "applied"})
        refused = self.call({"command": "record_event", "batch_id": "final-batch-1", "unit_id": "u1",
                             "option_id": oid, "action": "rejected", "reason": "other"}, ok=False)
        self.assertIn("already applied", refused["error"])

    # ---- P1-e (Python half): clearances from wall FACES, not location lines
    def test_furniture_keeps_clear_of_wall_faces_when_thickness_is_given(self):
        ext_t, int_t = 0.51, 0.2
        out = self.call({"command": "generate_batch", "units": [self.unit(
            width_m=14, height_m=12, exterior_wall_thickness_m=ext_t, interior_wall_thickness_m=int_t)]})
        options = out["units"][0]["options"]
        self.assertTrue(options)
        for o in options:
            w, h = o["width_m"], o["height_m"]
            rooms = {r["name"]: r for r in o["rooms"]}
            for f in o["furniture"]:
                r = rooms[f["room"]]
                half = lambda at, lim: (ext_t if abs(at - lim) < 1e-6 else int_t) / 2
                fx1, fy1 = r["x1"] + half(r["x1"], 0), r["y1"] + half(r["y1"], 0)
                fx2, fy2 = r["x2"] - half(r["x2"], w), r["y2"] - half(r["y2"], h)
                # Furniture stands against the wall FACE (≥ 1 cm, C# FurniturePlanner.Safe),
                # never inside the wall.
                self.assertGreaterEqual(f["x"] - f["width"] / 2, fx1 + 0.0099, (f, r))
                self.assertLessEqual(f["x"] + f["width"] / 2, fx2 - 0.0099, (f, r))
                self.assertGreaterEqual(f["y"] - f["depth"] / 2, fy1 + 0.0099, (f, r))
                self.assertLessEqual(f["y"] + f["depth"] / 2, fy2 - 0.0099, (f, r))

    def test_zero_thickness_is_the_previous_behaviour(self):
        a = self.call({"command": "generate_batch", "batch_id": "thick-0-a", "units": [self.unit()]})
        b = self.call({"command": "generate_batch", "batch_id": "thick-0-b", "units": [self.unit(
            exterior_wall_thickness_m=0, interior_wall_thickness_m=0)]})
        self.assertEqual([o["furniture"] for o in a["units"][0]["options"]],
                         [o["furniture"] for o in b["units"][0]["options"]])

    def test_out_of_range_thickness_is_a_unit_error(self):
        out = self.call({"command": "generate_batch", "units": [self.unit(exterior_wall_thickness_m=2)]})
        self.assertIn("Гадна ханын зузаан", out["units"][0]["error"])

    def test_output_never_contains_non_finite_numbers(self):
        out = self.call({"command": "generate_batch", "units": [self.unit(width_m=30, height_m=7.8, bedrooms=4, bathrooms=2)]})
        def walk(x):
            if isinstance(x, float):
                self.assertTrue(math.isfinite(x))
            elif isinstance(x, dict):
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
