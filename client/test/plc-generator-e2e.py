"""Actual Angular Dialog + real API + temporary SQLite. No existing project/PLC."""
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
DEVICE = "d_b6ba9d1c-2b054dc3"


def open_generator(page, url):
    page.goto(url + "/device")
    page.wait_for_load_state("networkidle")
    notice = page.locator("app-section-message-dialog")
    if notice.count():
        notice.locator(".dialog-close-btn").click()
        expect(notice).to_have_count(0)
    page.get_by_text("more_vert", exact=True).click()
    page.get_by_role("menuitem", name="PLC Tag Generator", exact=True).click()
    expect(page.get_by_role("tab", name="Generator Configurations", exact=True)).to_be_visible()


def api(request, url, path, data=None):
    response = request.get(url + "/api/plc-device-models" + path) if data is None else request.post(
        url + "/api/plc-device-models" + path, data=data)
    assert response.ok, response.text()
    return response.json()


def run_browser(url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        request = p.request.new_context()
        initial = api(request, url, "/configurations")
        tasks = [dict(schemaVersion=2, id="task_" + str(i), name="Task " + str(i), deviceId=DEVICE,
                      tagPrefix="Task" + str(i), adsSymbol="GVL.bTask" + str(i),
                      valueKind="primitive", plcType="BOOL", array=dict(mode="scalar")) for i in range(50)]
        api(request, url, "/configurations", dict(configurations=tasks, expectedHash=initial["hash"]))
        for width, height, scale in [(1920, 1080, 1), (1366, 768, 1), (1024, 768, 1), (1092, 614, 1.25)]:
            context = browser.new_context(viewport=dict(width=width, height=height), device_scale_factor=scale)
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            open_generator(page, url)
            assert page.get_by_role("tab").count() == 2
            assert page.get_by_text("Legacy Valve CSV", exact=True).count() == 0
            page.get_by_role("button", name="New Configuration", exact=True).click()
            surface = page.locator(".mat-mdc-dialog-surface").filter(has=page.locator("app-plc-device-models"))
            box = surface.bounding_box()
            assert box["x"] >= -1 and box["y"] >= -1 and box["x"] + box["width"] <= width + 1
            assert box["y"] + box["height"] <= height + 1
            content = page.locator(".model-dialog")
            assert content.evaluate("(e) => e.scrollWidth <= e.clientWidth + 1")
            assert page.locator(".task-scroll").first.evaluate("(e) => e.scrollHeight > e.clientHeight")
            content.evaluate("(e) => e.scrollTop = e.scrollHeight")
            for locator in [page.locator(".dialog-heading"), page.locator(".dialog-footer")]:
                rect = locator.bounding_box()
                assert rect["y"] >= 0 and rect["y"] + rect["height"] <= height + 1
            page.get_by_role("button", name="Save Configuration", exact=True).click()
            page.get_by_role("button", name="Preview Tags", exact=True).click()
            expect(page.locator(".preview-panel")).to_contain_text("Candidates 1")
            assert page.locator(".preview-panel .table-scroll").evaluate("(e) => e.scrollWidth > e.clientWidth")
            if width == 1366:
                page.screenshot(path=str(Path(tempfile.gettempdir()) / "nexfuxa-dialog-1366.png"))
            page.get_by_role("button", name="Close generator").click()
            context.close()
            # Each layout case saves a unique task; remove only the generated test task via API.
            current = api(request, url, "/configurations")
            api(request, url, "/configurations", dict(configurations=tasks, expectedHash=current["hash"]))
            print("E2E viewport", width, height, scale, "passed")

        context = browser.new_context(viewport=dict(width=1366, height=768))
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        open_generator(page, url)
        page.get_by_role("tab", name="Model Library", exact=True).click()
        page.get_by_role("button", name="New Model", exact=True).click()
        page.get_by_label("Model Name", exact=True).fill("OnlinePump")
        page.get_by_label("Structure Type Name", exact=True).fill("ST_OnlinePump")
        page.get_by_label("Member Name 0", exact=True).fill("Speed")
        page.get_by_label("PLC Type 0", exact=True).select_option("REAL")
        page.get_by_role("button", name="Add Structure / Group", exact=True).click()
        page.get_by_label("Editing Structure", exact=False).select_option("ST_Group1")
        page.get_by_label("Member Name 0", exact=True).fill("Running")
        speed = page.locator(".library-layout .member-editor").filter(has=page.locator("summary", has_text="Speed"))
        speed.locator(":scope > summary").click()
        speed.get_by_label("Record History", exact=True).check()
        speed.get_by_label("Interval (seconds)", exact=True).fill("10")
        speed.get_by_label("Save if Changed", exact=True).check()
        speed.get_by_label("Description", exact=True).fill("Pump speed")
        page.get_by_role("button", name="Save Model", exact=True).click()
        expect(page.locator(".library-layout .task").filter(has_text="OnlinePump@1.0.0")).to_be_visible()
        models = api(request, url, "/models")["models"]
        assert models[0]["memberDefaults"]["Speed"]["daq"]["interval"] == 10
        assert models[0]["types"]["ST_Group1"]["Running"] == "BOOL"
        page.get_by_role("button", name="Use Model in Configuration", exact=True).click()
        page.get_by_role("tab", name="Generator Configurations", exact=True).click()
        page.get_by_label("Configuration Name", exact=True).fill("Online pump")
        page.get_by_label("Tag Prefix", exact=True).fill("OnlinePump")
        page.get_by_label("ADS Symbol", exact=True).fill("GVL.stOnlinePump")
        members = page.locator(".config-form .member-editor")
        members.filter(has=page.locator("summary", has_text="Group1.Running")).locator("summary input").uncheck()
        config_speed = members.filter(has=page.locator("summary", has_text="Speed"))
        config_speed.locator(":scope > summary").click()
        config_speed.get_by_label("Interval (seconds)", exact=True).fill("5")
        page.get_by_role("button", name="Save Configuration", exact=True).click()
        page.get_by_role("button", name="Preview Tags", exact=True).click()
        expect(page.locator(".preview-panel")).to_contain_text("Candidates 1")
        row = page.locator(".preview-panel tbody tr")
        expect(row).to_contain_text("Pump speed")
        expect(row).to_contain_text("Created")
        page.get_by_role("button", name="Confirm Apply", exact=True).click()
        expect(page.locator("app-plc-device-models")).to_have_count(0)
        project = request.get(url + "/api/project").json()
        tags = project["devices"][DEVICE]["tags"]
        tag = next(value for value in tags.values() if value.get("address") == "GVL.stOnlinePump.Speed")
        assert tag["daq"] == dict(enabled=True, interval=5, changed=True, restored=False)
        assert tag["description"] == "Pump speed"

        open_generator(page, url)
        page.get_by_role("button", name="Online pump", exact=False).click()
        page.get_by_label("Configuration Name", exact=True).fill("Unsaved draft export")
        with page.expect_download() as download_info:
            page.get_by_role("button", name="Export Current Configuration (draft)", exact=True).click()
        download = download_info.value
        exported = json.loads(Path(download.path()).read_text(encoding="utf-8"))
        assert exported["draft"] is True and exported["configurations"][0]["name"] == "Unsaved draft export"
        page.locator(".task-list input[type=file]").set_input_files(dict(
            name="roundtrip.json", mimeType="application/json", buffer=json.dumps(exported).encode("utf-8")))
        import_preview = page.locator('section[aria-label="JSON import preview"]')
        expect(import_preview).to_contain_text("Conflicts 1")
        import_preview.locator("select").select_option("overwrite")
        page.get_by_role("button", name="Confirm import", exact=True).click()
        expect(import_preview).to_have_count(0)
        imported = api(request, url, "/configurations")["configurations"]
        assert next(c for c in imported if c["id"] == exported["configurations"][0]["id"]) == exported["configurations"][0]
        assert len(imported) == 51
        page.get_by_role("button", name="Unsaved draft export", exact=False).click()
        page.get_by_label("Configuration Name", exact=True).fill("Online pump")
        page.get_by_role("button", name="Save Configuration", exact=True).click()
        members = page.locator(".config-form .member-editor")
        config_speed = members.filter(has=page.locator("summary", has_text="Speed"))
        config_speed.locator(":scope > summary").click()
        config_speed.get_by_label("Interval (seconds)", exact=True).fill("20")
        page.get_by_role("button", name="Save Configuration", exact=True).click()
        page.get_by_role("button", name="Preview Tags", exact=True).click()
        expect(page.locator(".preview-panel tbody tr")).to_contain_text("Reused")
        expect(page.locator(".preview-panel tbody tr")).to_contain_text("Existing properties preserved")
        page.get_by_role("button", name="Confirm Apply", exact=True).click()
        expect(page.locator("app-plc-device-models")).to_have_count(0)
        after = request.get(url + "/api/project").json()["devices"][DEVICE]["tags"]
        assert after[tag["id"]] == tag

        open_generator(page, url)
        page.get_by_role("tab", name="Model Library", exact=True).click()
        page.locator(".library-layout .task").filter(has_text="OnlinePump@1.0.0").click()
        page.get_by_role("button", name="Edit Draft / Save as New Version", exact=True).click()
        expect(page.get_by_label("Model Version", exact=True)).to_have_value("1.0.1")
        page.get_by_label("PLC Type 0", exact=True).select_option("DINT")
        page.get_by_role("button", name="Save as New Version", exact=True).click()
        expect(page.locator(".library-layout .task").filter(has_text="OnlinePump@1.0.1")).to_be_visible()
        stored = api(request, url, "/models")["models"]
        assert len(stored) == 2 and stored[0]["types"]["ST_OnlinePump"]["Speed"] == "REAL"
        saved = api(request, url, "/configurations")["configurations"]
        assert next(c for c in saved if c["name"] == "Online pump")["model"] == "OnlinePump@1.0.0"
        print("E2E online model editor, nested members, DAQ override, Apply/reuse, draft export, new version passed")
        context.close()
        request.dispose()
        browser.close()


def main():
    with tempfile.TemporaryDirectory(prefix="nexfuxa-ui-") as directory:
        root = Path(directory)
        assert root.parent.resolve() == Path(tempfile.gettempdir()).resolve()
        work = root / "_appdata"
        work.mkdir()
        settings = "const settings = require(" + json.dumps(str(ROOT / "server/settings.default.js")) + "); settings.uiHost = '127.0.0.1'; settings.nodeRedEnabled = false; module.exports = settings;"
        (work / "settings.js").write_text(settings, encoding="utf-8")
        subprocess.run(["node", str(ROOT / "server/test/plc-device-models/persistence.child.cjs"), "seed", str(work)], check=True, cwd=ROOT)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        url = "http://127.0.0.1:" + str(port)
        with (root / "server.log").open("w+", encoding="utf-8", errors="replace") as log:
            server = subprocess.Popen(["node", "main.js", "--userDir", str(root), "--port", str(port)], cwd=ROOT / "server", stdout=log, stderr=log)
            try:
                for _ in range(120):
                    try:
                        urllib.request.urlopen(url + "/api/plc-device-models", timeout=1)
                        break
                    except Exception:
                        if server.poll() is not None:
                            raise RuntimeError("Isolated server exited")
                        time.sleep(0.5)
                else:
                    raise RuntimeError("Isolated server did not start")
                run_browser(url)
            except Exception:
                log.seek(0)
                print(log.read()[-6000:])
                raise
            finally:
                server.terminate()
                server.wait(timeout=30)


if __name__ == "__main__":
    main()
