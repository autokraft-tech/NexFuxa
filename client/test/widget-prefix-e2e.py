"""Production Angular + real HmiService/Socket.IO + disposable SQLite; no PLC."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
DEVICE = 'd_b6ba9d1c-2b054dc3'


def run_browser(url, server):
    def emit(event, payload):
        server.stdin.write(json.dumps(dict(event=event, payload=payload)) + '\n')
        server.stdin.flush()

    def values(prefix, active):
        active = {active} if isinstance(active, int) else set(active)
        emit('device-value:changed', dict(id=DEVICE, values=[dict(id=f't_fixture_{prefix}_{i}', value=i in active)
                                                          for i in range(6)]))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Pin a valid BCP 47 locale instead of inheriting the runner's POSIX locale.
        page = browser.new_page(viewport=dict(width=1366, height=768), locale='en-US')
        initial_tags = page.request.get(url + '/api/project').json()['devices'][DEVICE]['tags']
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url + '/home/Prefix%20Binding%20Fixture')
        assert page.evaluate('navigator.language') == 'en-US'
        assert page.evaluate('new Intl.Locale(navigator.language).baseName') == 'en-US'
        a = page.locator('[id^="widget_V101__"] [id^="statusText_"]')
        b = page.locator('[id^="widget_V102__"] [id^="statusText_"]')
        expect(a).to_have_text('WAITING FOR DATA')
        expect(b).to_have_text('WAITING FOR DATA')
        emit('device-status:changed', dict(id=DEVICE, status='connect-ok'))
        values('V101', 0)
        values('V102', 1)
        expect(a).to_have_text('EXTENDED')
        expect(b).to_have_text('RETRACTED')
        for state, active in [('EXTENDED', {0}), ('FAULT', {0, 1, 4}), ('CONFLICT', {0, 1})]:
            values('V101', active)
            expect(a).to_have_text(state)
            # A tag-data outage is local to V101 even on the same PLC Device.
            emit('device-value:changed', dict(id=DEVICE, values=[dict(id=f't_fixture_V101_{i}', value=None) for i in range(6)]))
            expect(a).to_have_text('WAITING FOR DATA')
            expect(b).to_have_text('RETRACTED')
            emit('device-value:changed', dict(id=DEVICE, values=[dict(id=f't_fixture_V101_{i}', value=i in active) for i in range(5)]))
            expect(a).to_have_text('WAITING FOR DATA')
            emit('device-value:changed', dict(id=DEVICE, values=[dict(id='t_fixture_V101_5', value=False)]))
            expect(a).to_have_text(state)
            expect(b).to_have_text('RETRACTED')
            # An actual Device disconnect invalidates both Widgets on that Device.
            emit('device-status:changed', dict(id=DEVICE, status='connect-error'))
            expect(a).to_have_text('WAITING FOR DATA')
            expect(b).to_have_text('WAITING FOR DATA')
            emit('device-status:changed', dict(id=DEVICE, status='connect-ok'))
            expect(a).to_have_text('WAITING FOR DATA')
            values('V101', active)
            expect(a).to_have_text(state)
            expect(b).to_have_text('WAITING FOR DATA')
            values('V102', 1)
            expect(b).to_have_text('RETRACTED')
        ids = page.locator('app-fuxa-view svg [id]').evaluate_all('(nodes) => nodes.map(n => n.id)')
        assert len(ids) == len(set(ids)), 'duplicate DOM IDs'
        emit('device-status:changed', dict(id=DEVICE, status='connect-error'))
        expect(a).to_have_text('WAITING FOR DATA')
        expect(b).to_have_text('WAITING FOR DATA')
        page.reload()
        expect(b).to_have_text('WAITING FOR DATA')
        emit('device-status:changed', dict(id=DEVICE, status='connect-ok'))
        values('V101', 1)
        values('V102', 0)
        expect(a).to_have_text('RETRACTED')
        expect(b).to_have_text('EXTENDED')
        project = page.request.get(url + '/api/project').json()
        view = next(v for v in project['hmi']['views'] if v['id'] == 'v_prefix_fixture')
        del view['items']['widget_V101']
        view['svgcontent'] = page.evaluate('''(source) => {
            const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
            doc.querySelector('[id="widget_V101"]').remove();
            return new XMLSerializer().serializeToString(doc);
        }''', view['svgcontent'])
        response = page.request.post(url + '/api/projectData', data=dict(cmd='set-view', data=view))
        assert response.ok
        page.reload()
        expect(page.locator('[id^="widget_V101__"]')).to_have_count(0)
        expect(b).to_have_text('WAITING FOR DATA')
        emit('device-status:changed', dict(id=DEVICE, status='connect-ok'))
        values('V102', 1)
        expect(b).to_have_text('RETRACTED')
        print('E2E production runtime: two instances, real Socket.IO routing, fault isolation, offline invalidation and reload passed')

        page.goto(url + '/editor')
        page.wait_for_load_state('networkidle')
        notice = page.locator('app-section-message-dialog')
        if notice.count():
            notice.locator('.dialog-close-btn').click()
        wizard = page.get_by_role('button', name='CLOSE', exact=True)
        if wizard.count():
            wizard.click()
        page.get_by_text('Prefix Binding Fixture', exact=True).first.click()
        # Import through the actual editor file flow, also testing metadata discovery.
        page.locator('input[accept="image/png|jpg|svg"]').first.set_input_files(ROOT / 'custom/widgets/valves/NexPlc_Valve.svg')
        page.wait_for_function("localStorage.getItem('NexPlc_Valve.svg') !== null")
        expect(page.locator('.svg-tool-active input[accept="image/png|jpg|svg"]').first).to_be_attached()
        page.locator('#svgroot').click(position=dict(x=420, y=230))
        page.locator('gauge-base button').click()
        panel = page.locator('flex-widget-property')
        panel.get_by_label('Binding Mode', exact=True).click()
        page.get_by_role('option', name='Prefix Binding', exact=True).click()
        panel.get_by_label('PLC Device', exact=True).click()
        page.get_by_role('option', name='TwinCAT_ADS Fixture', exact=True).click()
        panel.get_by_label('Tag Prefix (#1)', exact=True).fill('V101')
        expect(panel.get_by_label('Tag Prefix (#1)', exact=True)).to_have_value('V101')
        expect(panel.locator('.binding-result')).to_have_count(6)
        expect(panel.locator('.binding-preview')).to_contain_text('t_fixture_V101_0')
        panel.get_by_label('Tag Prefix (#1)', exact=True).fill('V102')
        expect(panel.locator('.binding-preview')).to_contain_text('t_fixture_V102_0')
        panel.get_by_label('Tag Prefix (#1)', exact=True).fill('Missing')
        expect(panel.locator('.binding-error')).to_have_count(6)
        panel.get_by_label('Tag Prefix (#1)', exact=True).fill('V101')
        panel.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-prefix-property.png'))
        page.get_by_role('button', name='OK', exact=True).click()
        page.locator('app-header button[title="Save Project"]').click()
        with page.expect_response(lambda response: response.url.endswith('/api/projectData') and
                                  response.request.post_data_json.get('cmd') == 'set-view'):
            page.get_by_role('menuitem', name='Save Project', exact=True).click()
        saved_project = page.request.get(url + '/api/project').json()
        assert saved_project['devices'][DEVICE]['tags'] == initial_tags
        saved_view = next(v for v in saved_project['hmi']['views'] if v['id'] == 'v_prefix_fixture')
        imported_id = next(key for key in saved_view['items'] if key not in ['widget_V101', 'widget_V102'])
        assert saved_view['items'][imported_id]['property']['prefixBinding']['parameters']['#1'] == 'V101'
        page.reload()
        page.wait_for_load_state('networkidle')
        wizard = page.get_by_role('button', name='CLOSE', exact=True)
        if wizard.count():
            wizard.click()
        page.locator('[id="' + imported_id + '"]').click(position=dict(x=20, y=20))
        page.locator('gauge-base button').click()
        expect(page.locator('flex-widget-property').get_by_label('Tag Prefix (#1)', exact=True)).to_have_value('V101')
        expect(page.locator('flex-widget-property .binding-result')).to_have_count(6)
        for width, height in [(1366, 768), (1024, 768), (1092, 614)]:
            page.set_viewport_size(dict(width=width, height=height))
            surface = page.locator('.mat-mdc-dialog-surface')
            box = surface.bounding_box()
            assert box['x'] >= -1 and box['y'] >= -1 and box['x'] + box['width'] <= width + 1
            assert box['y'] + box['height'] <= height + 1
            assert page.locator('flex-widget-property > .container').evaluate('(e) => e.scrollWidth <= e.clientWidth + 1')
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-prefix-editor.png'))
        assert not errors, errors
        print('E2E actual Angular property dialog: import, profile, prefix editing, IDs, missing-tag preview, save/reload and 3 viewport layouts passed')
        browser.close()


def main(fixture='widget-prefix-fixture.cjs', runner=run_browser, broadcast_all=True, lazy=False, restart_runner=None):
    with tempfile.TemporaryDirectory(prefix='nexfuxa-prefix-ui-') as directory:
        root = Path(directory)
        work = root / '_appdata'
        work.mkdir()
        static = os.environ.get('FUXA_TEST_CLIENT_DIST', str(ROOT / 'client/dist'))
        settings = 'const s = require(' + json.dumps(str(ROOT / 'server/settings.default.js')) + ');'
        settings += "s.uiHost='127.0.0.1';s.nodeRedEnabled=false;s.broadcastAll=" + str(broadcast_all).lower() + ';'
        settings += 's.lazyViewLoading=' + str(lazy).lower() + ';'
        settings += 's.httpStatic=' + json.dumps(static) + ';module.exports=s;'
        (work / 'settings.js').write_text(settings, encoding='utf-8')
        subprocess.run(['node', str(ROOT / 'client/test' / fixture), 'seed', str(work)], check=True, cwd=ROOT)
        wrapper = root / 'server.cjs'
        wrapper.write_text('require(' + json.dumps(str(ROOT / 'server/main.js')) + ');\n' +
                           "require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);const r=require(" +
                           json.dumps(str(ROOT / 'server/runtime')) + ');if(m.event==="fixture-disconnect"){r.io.sockets.sockets.forEach(s=>s.conn.close());}' +
                           'else if(m.event==="fixture-assert-tags"){r.io.sockets.sockets.forEach(s=>require("node:assert/strict").deepEqual([...new Set(s.tagsClientSubscriptions.filter(t=>t.startsWith("t_fixture_")))].sort(),m.payload.sort()));}' +
                           'else{r.events.emit(m.event,m.payload);}});', encoding='utf-8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        url = 'http://127.0.0.1:' + str(port)
        with (root / 'server.log').open('w+', encoding='utf-8', errors='replace') as log:
            for current_runner in [runner] + ([restart_runner] if restart_runner else []):
                server = subprocess.Popen(['node', str(wrapper), '--userDir', str(root), '--port', str(port)],
                                          cwd=ROOT / 'server', stdout=log, stderr=log, stdin=subprocess.PIPE, text=True)
                try:
                    for _ in range(120):
                        try:
                            urllib.request.urlopen(url + '/api/project', timeout=1)
                            break
                        except Exception:
                            if server.poll() is not None:
                                raise RuntimeError('Isolated server exited')
                            time.sleep(.5)
                    current_runner(url, server)
                except Exception:
                    log.seek(0)
                    print(log.read()[-4000:])
                    raise
                finally:
                    server.terminate()
                    server.wait(timeout=30)


if __name__ == '__main__':
    main()
