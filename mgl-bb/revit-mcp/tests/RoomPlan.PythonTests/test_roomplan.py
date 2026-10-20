"""Offline batch & preference contract tests. No Revit, AI, internet or pip."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CLI = Path(__file__).resolve().parents[2] / "addin" / "RoomPlan" / "Python" / "roomplan_cli.py"


class RoomPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = dict(os.environ, MGL_ROOMPLAN_DB_PATH=str(Path(self.tmp.name) / "prefs.sqlite3"))

    def call(self, data, ok=True):
        result = subprocess.run([sys.executable, str(CLI)], input=json.dumps(data, ensure_ascii=False),
                                text=True, encoding="utf-8", capture_output=True, env=self.env,
                                timeout=10)
        response = json.loads(result.stdout)
        if ok:
            self.assertEqual(result.returncode, 0, (response, result.stderr))
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("error", response)
        return response

    def fixture(self, entry="south", bedrooms=2, width=12, height=11, uid="u1"):
        return dict(unit_id=uid, width_m=width, height_m=height, bedrooms=bedrooms, entry=entry)

    REQUIRED = {"Унтлагын": ({"Bed", "BedSingle"},), "Зочны": ({"Sofa"}, {"Kitchen"}),
                "Ариун": ({"Toilet"}, {"Basin"})}

    def assert_furnished(self, o, ext=0.2, inner=0.1):
        """Mirror of C# FurniturePlanner.Safe + the bridge's required-kind check."""
        rooms = {r["name"]: r for r in o["rooms"]}
        w, h = o["width_m"], o["height_m"]
        for r in o["rooms"]:
            kinds = {f["kind"] for f in o["furniture"] if f["room"] == r["name"]}
            for prefix, needs in self.REQUIRED.items():
                if r["name"].startswith(prefix):
                    for need in needs:
                        self.assertTrue(kinds & need, (r["name"], need, kinds))
        for f in o["furniture"]:
            r = rooms[f["room"]]
            half = lambda at, lim: (ext if abs(at - lim) < 1e-6 else inner) / 2
            b = (f["x"] - f["width"] / 2, f["y"] - f["depth"] / 2, f["x"] + f["width"] / 2, f["y"] + f["depth"] / 2)
            self.assertGreaterEqual(b[0], r["x1"] + half(r["x1"], 0) + .0099, (f, r))
            self.assertLessEqual(b[2], r["x2"] - half(r["x2"], w) - .0099, (f, r))
            self.assertGreaterEqual(b[1], r["y1"] + half(r["y1"], 0) + .0099, (f, r))
            self.assertLessEqual(b[3], r["y2"] - half(r["y2"], h) - .0099, (f, r))
            self.assertIn(f.get("back"), (None, "south", "north", "west", "east"))
            for d in o["doors"]:
                cx, cy = d["center"]["x"], d["center"]["y"]
                along_x = r["x1"] - .01 <= cx <= r["x2"] + .01
                along_y = r["y1"] - .01 <= cy <= r["y2"] + .01
                if along_x and abs(cy - r["y1"]) < .02: z = (cx - .55, r["y1"], cx + .55, r["y1"] + .95)
                elif along_x and abs(cy - r["y2"]) < .02: z = (cx - .55, r["y2"] - .95, cx + .55, r["y2"])
                elif along_y and abs(cx - r["x1"]) < .02: z = (r["x1"], cy - .55, r["x1"] + .95, cy + .55)
                elif along_y and abs(cx - r["x2"]) < .02: z = (r["x2"] - .95, cy - .55, r["x2"], cy + .55)
                else: continue
                self.assertFalse(b[0] < z[2] - 1e-6 and b[2] > z[0] + 1e-6 and b[1] < z[3] - 1e-6 and b[3] > z[1] + 1e-6,
                                 ("door swing", f, d))
        same = {}
        for f in o["furniture"]:
            same.setdefault(f["room"], []).append(f)
        for items in same.values():
            for i, a in enumerate(items):
                for c in items[i + 1:]:
                    self.assertFalse(abs(a["x"] - c["x"]) < (a["width"] + c["width"]) / 2 - 1e-6 and
                                     abs(a["y"] - c["y"]) < (a["depth"] + c["depth"]) / 2 - 1e-6, (a, c))

    def test_batch_multiple_units_and_options(self):
        units = [self.fixture(uid="a"),self.fixture(uid="b",entry="north",bedrooms=1),
                 self.fixture(uid="c",entry="east",bedrooms=3),
                 self.fixture(uid="d",entry="west",bedrooms=2)]
        out = self.call({"command":"generate_batch","batch_id":"demo-batch-1","units":units})
        self.assertEqual(len(out["units"]), 4)
        self.assertTrue(all(u["unit_id"] == item["unit_id"] for u,item in zip(units,out["units"])))
        for unit, output in zip(units,out["units"]):
            self.assertGreater(len(output["options"]), 2)
            self.assertLessEqual(len(output["options"]), 36)
            self.assertEqual(len({o["option_id"] for o in output["options"]}),len(output["options"]))
            self.assertEqual([o["score"] for o in output["options"]],
                             sorted((o["score"] for o in output["options"]), reverse=True))
            for o in output["options"]:
                self.assertEqual(o["doors"][0]["host_wall"],unit["entry"])
                names=[r["name"] for r in o["rooms"]]
                self.assertEqual(sum(n.startswith("Унтлагын") for n in names),unit["bedrooms"])
                self.assertEqual(sum(n.startswith("Ариун") for n in names),1)
                self.assertEqual(sum(n.startswith("Зочны") for n in names),1)
                self.assertTrue({"south","north","west","east"} <=
                                {w["id"] for w in o["walls"]})
                self.assertAlmostEqual(sum((r["x2"]-r["x1"])*(r["y2"]-r["y1"])
                                           for r in o["rooms"]),o["width_m"]*o["height_m"],places=3)

    def test_original_precedent_library_and_geometry_uniqueness(self):
        # Six original hand-authored programs form an adaptive library,
        # not a third-party/Finch dataset or a trained ML model.
        for bedroom_count in (1,2,3):
            out=self.call({"command":"generate_batch",
                "units":[self.fixture(bedrooms=bedroom_count, width=14, height=12)]})
            options=out["units"][0]["options"]
            families={o["topology"] for o in options}
            self.assertTrue({"central-hall","side-hall","living-hub","entry-gallery"}
                .issubset(families),families)
            self.assertTrue(any(o["library_origin"] for o in options))
            self.assertEqual(len({o["option_id"] for o in options}),len(options))
            for o in options:
                self.assertGreater(len(o["furniture"]),0)
                self.assertGreater(o["score"],0)
                self.assertEqual(o["doors"][0]["host_wall"],"south")
                # Several rectangles may form ONE corridor ("Хонгил");
                # every other room name is unique (furniture keys on it).
                room_names=[p["name"] for p in o["rooms"] if p["name"]!="Хонгил"]
                self.assertEqual(len(room_names),len(set(room_names)))
                self.assertIn("Зочны өрөө + гал тогоо",room_names)
                self.assertIn("Ариун цэврийн өрөө",room_names)

    def test_tracking_and_explicit_rejection(self):
        out = self.call({"command":"generate_batch","batch_id":"12345","units":[self.fixture()]})
        options = out["units"][0]["options"]
        opt1,opt2=options[0],options[1]
        first = {"command":"record_event","batch_id":"12345","unit_id":"u1",
                 "option_id":opt1["option_id"],"event_id":"event-1","action":"applied"}
        self.call(first)
        self.call(first)  # same event_id retried: the contract should be idempotent
        self.call({"command":"record_event","batch_id":"12345","unit_id":"u1",
                   "option_id":opt2["option_id"],"action":"rejected","reason":"bad_circulation"})
        a=self.call({"command":"analytics"})
        self.assertEqual(a["actions"]["applied"],1)
        self.assertEqual(a["actions"]["rejected"],1)
        self.assertEqual(a["explicit_rejection_reasons"]["bad_circulation"],1)
        self.call({"command":"record_event","batch_id":"12345","unit_id":"u1",
                   "option_id":opt2["option_id"],"action":"rejected"},ok=False)
        self.call({"command":"record_event","batch_id":"12345","unit_id":"u1",
                   "option_id":"unknown","action":"applied"},ok=False)

    def test_distinct_topologies_and_cardinal_entrances(self):
        for entry in ("south","north","east","west"):
            out=self.call({"command":"generate_batch","units":[self.fixture(entry=entry)]})
            templates={x["template"] for x in out["units"][0]["options"]}
            self.assertTrue(any(t.startswith("central-") for t in templates),templates)
            self.assertTrue(any(t.startswith("side-hall-") for t in templates),templates)
            for option in out["units"][0]["options"]:
                self.assertEqual(option["doors"][0]["host_wall"],entry)
                self.assert_furnished(option)

    def test_preference_uses_explicit_actions_and_is_bounded(self):
        # Three architect-approved side-hall-left and three explicitly rejected
        # side-hall-right plans, across independent batch sessions.
        for i in range(3):
            out=self.call({"command":"generate_batch",
                           "batch_id":f"learn-batch-{i}",
                           "units":[self.fixture()]})
            options=out["units"][0]["options"]
            for template,action,reason in (
                ("side-hall-left","applied",None),
                ("side-hall-right","rejected","bad_circulation")):
                picked=next((o for o in options if o["template"]==template),None)
                self.assertIsNotNone(picked,template)
                event={"command":"record_event","batch_id":f"learn-batch-{i}",
                       "unit_id":"u1","option_id":picked["option_id"],
                       "action":action}
                if reason:event["reason"]=reason
                self.call(event)
        out=self.call({"command":"generate_batch","batch_id":"learn-next",
                       "units":[self.fixture()]})
        options=out["units"][0]["options"]
        left=next(x for x in options if x["template"]=="side-hall-left")
        right=next(x for x in options if x["template"]=="side-hall-right")
        self.assertGreater(left["preference_adjustment"],0)
        self.assertLess(right["preference_adjustment"],0)
        self.assertLessEqual(max(abs(left["preference_adjustment"]),
                                 abs(right["preference_adjustment"])),4)
        self.assertEqual(self.call({"command":"analytics"})[
            "explicit_rejection_reasons"]["bad_circulation"],3)

    def test_reachability_and_wall_host_validation_reject_corruption(self):
        import copy
        sys.path.insert(0,str(CLI.parent))
        from plan_validation import validate_plan
        batch=self.call({"command":"generate_batch","units":[self.fixture(width=14,height=12)]})
        for option in batch["units"][0]["options"]:
            valid,reason,metrics=validate_plan(option["width_m"],option["height_m"],
                option["walls"],option["rooms"],option["doors"])
            self.assertTrue(valid,reason)
            self.assertTrue(metrics["connected_to_entry"])
            self.assertFalse(metrics["norms_validated"])
            self.assertAlmostEqual(metrics["usable_area_m2"],168,places=1)
            self.assertLessEqual(metrics["area_efficiency_percent"],100)
        base=batch["units"][0]["options"][0]
        broken=copy.deepcopy(base)
        broken["doors"]=broken["doors"][:1]
        self.assertFalse(validate_plan(broken["width_m"],broken["height_m"],
            broken["walls"],broken["rooms"],broken["doors"])[0])
        broken=copy.deepcopy(base)
        broken["rooms"][0]["x2"]+=1.0
        self.assertFalse(validate_plan(broken["width_m"],broken["height_m"],
            broken["walls"],broken["rooms"],broken["doors"])[0])
        broken=copy.deepcopy(base)
        broken["doors"][0]["host_wall"]="does-not-exist"
        self.assertFalse(validate_plan(broken["width_m"],broken["height_m"],
            broken["walls"],broken["rooms"],broken["doors"])[0])

    def test_every_option_passes_the_revit_side_gates(self):
        # Revit re-checks each Python option (RoomPlanRanking.GeometrySafe +
        # FurniturePlanner.Safe) and silently drops failures, so the gallery
        # would shrink.  Mirror those C# gates for every entry side.
        import itertools, math
        def box(f):
            return (f["x"]-f["width"]/2,f["y"]-f["depth"]/2,
                    f["x"]+f["width"]/2,f["y"]+f["depth"]/2)
        for entry,bedrooms,(w,h) in itertools.product(
                ("south","north","east","west"),(1,2,3),((12,11),(14,12),(10,9),(16,14))):
            out=self.call({"command":"generate_batch",
                "units":[self.fixture(entry=entry,bedrooms=bedrooms,width=w,height=h)]})
            for o in out["units"][0]["options"]:
                for r in o["rooms"]:
                    if r["name"]!="Хонгил":
                        self.assertGreaterEqual(min(r["x2"]-r["x1"],r["y2"]-r["y1"]),2.15)
                self.assert_furnished(o)

    def test_side_hall_survives_when_default_spot_faces_a_door(self):
        # The fixed kitchen corner used to sit on the hall door of every
        # non-mirrored side-hall plan, discarding the whole template.
        out=self.call({"command":"generate_batch","units":[self.fixture()]})
        templates={o["template"] for o in out["units"][0]["options"]}
        self.assertIn("side-hall-left",templates)
        self.assertIn("side-hall-right",templates)

    def test_program_bedrooms_bathrooms_and_storage(self):
        out=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=16,height=13,bedrooms=4,uid="big"),bathrooms=2,
                 facades=["north","east"])]})
        options=out["units"][0]["options"]
        self.assertGreater(len(options),10)
        for o in options:
            names=[r["name"] for r in o["rooms"]]
            self.assertEqual(sum(n.startswith("Унтлагын") for n in names),4)
            self.assertEqual(sum(n.startswith("Ариун") for n in names),2)
            # bed per bedroom + sofa + kitchen + WC/basin per bathroom
            self.assert_furnished(o)
            beds=sorted(((r["x2"]-r["x1"])*(r["y2"]-r["y1"]),r["name"]) for r in o["rooms"]
                        if r["name"].startswith("Унтлагын"))
            master=next(a for a,n in beds if n=="Унтлагын өрөө 1")
            self.assertAlmostEqual(master,beds[-1][0],places=4,msg="largest bedroom is the master")

    def test_single_facade_prefers_fully_daylit_layouts(self):
        out=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=12,height=9,bedrooms=3),bathrooms=2,facades=["north"])]})
        options=out["units"][0]["options"]
        best=options[0]
        self.assertEqual(best["metrics"]["daylit_rooms"],best["metrics"]["habitable_rooms"])
        self.assertIn(best["topology"],("t-hall","l-hall"))
        for part in ("daylight","area_fit","squareness","circulation","zoning"):
            self.assertTrue(0<=best["score_parts"][part]<=1)
        self.assertGreaterEqual(len({o["topology"] for o in options}),2)

    def test_facades_change_the_ranking_and_follow_rotation(self):
        north=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=11,height=9,entry="east"),facades=["west"])]})
        best=north["units"][0]["options"][0]
        living=next(r for r in best["rooms"] if r["name"].startswith("Зочны"))
        self.assertAlmostEqual(living["x1"],0.0,places=4,msg="living room on the west window wall")
        self.assertEqual(best["doors"][0]["host_wall"],"east")

    def test_multi_rectangle_corridor_is_one_connected_space(self):
        sys.path.insert(0,str(CLI.parent))
        from plan_validation import validate_plan
        out=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=12,height=9,bedrooms=3),bathrooms=2,facades=["north"])]})
        multi=[o for o in out["units"][0]["options"]
               if sum(r["name"]=="Хонгил" for r in o["rooms"])>1]
        self.assertTrue(multi)
        for o in multi:
            ok,why,_=validate_plan(o["width_m"],o["height_m"],o["walls"],o["rooms"],o["doors"])
            self.assertTrue(ok,why)
            halls=[r for r in o["rooms"] if r["name"]=="Хонгил"]
            # no interior wall may run along the seam between corridor pieces
            for w in o["walls"]:
                if w["id"] in ("south","north","west","east"): continue
                a,b=w["start"],w["end"]
                for h1 in halls:
                    for h2 in halls:
                        if h1 is h2: continue
                        if abs(a["x"]-b["x"])<1e-6 and abs(a["x"]-h1["x2"])<1e-6 and abs(h1["x2"]-h2["x1"])<1e-6:
                            lo,hi=max(h1["y1"],h2["y1"]),min(h1["y2"],h2["y2"])
                            self.assertFalse(min(a["y"],b["y"])<hi-1e-6 and max(a["y"],b["y"])>lo+1e-6)

    def test_generation_is_fast_and_deterministic(self):
        import time
        units=[self.fixture(uid="u%02d"%i,width=10+i%5,height=9+i%3,
                            bedrooms=1+i%3) for i in range(12)]
        start=time.perf_counter()
        first=self.call({"command":"generate_batch","batch_id":"speed-1","units":units})
        elapsed=time.perf_counter()-start
        self.assertLess(elapsed,15.0,"12 units must stay well inside the 60 s Revit timeout")
        second=self.call({"command":"generate_batch","batch_id":"speed-2","units":units})
        self.assertEqual([[o["option_id"] for o in u["options"]] for u in first["units"]],
                         [[o["option_id"] for o in u["options"]] for u in second["units"]])

    def test_local_accepted_plan_is_reusable_without_ai(self):
        original=self.call({"command":"generate_batch","batch_id":"accepted-example-1",
            "units":[self.fixture(width=14,height=12,bedrooms=2)]})
        candidates=original["units"][0]["options"]
        chosen=next(x for x in candidates if x["topology"]=="living-hub")
        self.call({"command":"record_event","batch_id":"accepted-example-1",
            "unit_id":"u1","option_id":chosen["option_id"],"action":"applied"})
        self.assertEqual(self.call({"command":"analytics"})["locally_saved_applied_plans"],1)
        result=self.call({"command":"generate_batch","batch_id":"similar-floor-2",
            "units":[self.fixture(width=14.2,height=12.0,bedrooms=2)]})
        reused=[o for o in result["units"][0]["options"]
                if o["template"].startswith("saved-")]
        self.assertTrue(reused,"previously used local plans should be adapted")
        for item in reused:
            self.assertAlmostEqual(item["width_m"],14.2)
            self.assertEqual(item["doors"][0]["host_wall"],"south")
            self.assert_furnished(item)
        # Large dimension differences must NOT stretch accepted precedents past
        # a conservative geometry envelope and pretend that they still fit.
        far=self.call({"command":"generate_batch","batch_id":"far-floor-3",
            "units":[self.fixture(width=24,height=20,bedrooms=2)]})
        self.assertFalse(any(o["template"].startswith("saved-")
            for o in far["units"][0]["options"]))

    def test_option_count_one_prioritizes_actual_highest_score(self):
        first=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=14,height=12),max_options=1)]})
        second=self.call({"command":"generate_batch","units":[
            dict(self.fixture(width=14,height=12),max_options=36)]})
        self.assertEqual(first["units"][0]["options"][0]["option_id"],
                         second["units"][0]["options"][0]["option_id"])

    def test_separate_installation_data(self):
        self.call({"command":"generate_batch","units":[self.fixture()]})
        first=self.call({"command":"analytics"})
        self.assertGreater(first["generated"],0)
        with tempfile.TemporaryDirectory() as alt:
            env_before=self.env
            self.env=dict(os.environ, MGL_ROOMPLAN_DB_PATH=str(Path(alt)/"data.db"))
            self.assertEqual(self.call({"command":"analytics"})["generated"],0)
            self.env=env_before

    def test_bad_input_fails_whole_batch(self):
        # Structural request errors still reject the whole batch.
        for units in (
            [self.fixture(uid="same"),self.fixture(uid="same")],
            [],
        ):
            self.call({"command":"generate_batch","units":units},ok=False)
            self.assertEqual(self.call({"command":"analytics"})["generated"],0)

    def test_one_bad_unit_does_not_cancel_the_others(self):
        out=self.call({"command":"generate_batch","units":[
            self.fixture(uid="good"), self.fixture(width=999,uid="wide"),
            self.fixture(entry="up",uid="sideways")]})
        good,wide,sideways=out["units"]
        self.assertGreater(len(good["options"]),2)
        self.assertNotIn("error",good)
        for bad in (wide,sideways):
            self.assertEqual(bad["options"],[])
            self.assertTrue(bad["error"])

    def test_option_identifiers_are_deterministic(self):
        req={"command":"generate_batch","batch_id":"batch-A","units":[self.fixture()]}
        first=self.call(req)
        second=self.call(req)
        self.assertEqual(first["units"],second["units"])
        self.assertEqual(self.call({"command":"analytics"})["generated"],
                         len(first["units"][0]["options"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
