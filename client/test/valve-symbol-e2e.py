"""Phase B: actual production Angular/View, Socket.IO and temporary SQLite; no PLC."""
import importlib.util
import json
import re
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect
spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('widget-prefix-e2e.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def run_browser(url, server):
    def emit(event, payload):
        server.stdin.write(json.dumps(dict(event=event, payload=payload)) + '\n')
        server.stdin.flush()

    def values(prefix, active=(), missing=(), quality=None, device_id=runner.DEVICE):
        emit('device-value:changed', dict(id=device_id, values=[dict(id=f't_fixture_{prefix}_{i}' + ('_other' if device_id.endswith('_other') else ''), value=None if i in missing else i in active, **({'quality':quality} if quality else {})) for i in range(6)]))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1366, height=768), locale='en-US')
        errors, writes = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('websocket', lambda ws: ws.on('framesent', lambda frame: writes.append(frame) if 'device-values' in str(frame) and 'set' in str(frame) else None))
        before = page.request.get(url + '/api/project').json()
        def frontend_device_enabled(route):
            response = route.fetch()
            data = response.json()
            if 'devices' in data:
                for device_id in [runner.DEVICE, runner.DEVICE + '_other']:
                    if device_id in data['devices']: data['devices'][device_id]['enabled'] = True
            route.fulfill(response=response, json=data)
        # Only the UI fixture sees an enabled device. The stored ADS device remains disabled;
        # all feedback travels through real HmiService/Socket.IO, with no driver connection.
        page.route(re.compile(r'/api/project(?:\?|$)'), frontend_device_enabled)
        page.goto(url + '/home?viewName=Valve%20Symbol%20Phase%20B')
        page.wait_for_load_state('networkidle')
        host = page.locator('app-home app-fuxa-view').first
        def symbol(variant):
            return host.locator(f'[id^="symbol_{variant}__"] [data-nexfuxa-symbol-root]')
        # Inspect actual DOM before selecting parts; root is identified by packaged metadata.
        expect(host.locator('metadata[data-nexfuxa-valve-symbol]')).to_have_count(4)
        page.evaluate("document.querySelectorAll('metadata[data-nexfuxa-valve-symbol]').forEach(m=>m.parentElement.setAttribute('data-nexfuxa-symbol-root',''))")
        emit('device-status:changed', dict(id=runner.DEVICE,status='connect-error'))
        for v in ['compact', 'standard', 'detailed']:
            expect(symbol(v).locator('[data-part="status"]')).to_have_text('COM LOST' if v == 'compact' else 'COMM_LOST')
        emit('device-status:changed', dict(id=runner.DEVICE,status='connect-ok'))
        values('V101', [0]); values('V102', [1,5])
        expect(symbol('compact').locator('[data-part="status"]')).to_have_text('EXT')
        expect(symbol('standard').locator('[data-part="status"]')).to_have_text('RETRACTED')
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('EXTENDED')
        expect(symbol('compact').locator('[data-part="icons"]')).to_contain_text('LOCK')
        expect(symbol('standard').locator('[data-part="icons"]')).to_contain_text('MAN')
        emit('device-status:changed', dict(id=runner.DEVICE + '_other',status='connect-ok'))
        values('V101', [4], device_id=runner.DEVICE + '_other')
        expect(symbol('other').locator('[data-part="status"]')).to_have_text('FAULT')
        expect(symbol('other').locator('[data-part="icons"]')).to_have_text('HMI ?')
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('EXTENDED')
        keys = page.evaluate('''() => [...document.querySelectorAll('app-home metadata[data-nexfuxa-valve-symbol]')].map(m=>window[m.parentElement.parentElement.getAttribute('data-fuxa-module')].getSnapshot().instanceKey)''')
        assert keys[0] == keys[2] and keys[0] != keys[3], keys
        # Same device with absent H, position/motion/Fault partial validity, conflict and fault-only emphasis.
        values('V101', [0], [5])
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('EXTENDED')
        expect(symbol('detailed').locator('[data-part="icons"]')).to_contain_text('HMI ?')
        values('V101', [0], [2])
        expect(symbol('detailed').locator('[data-part="icons"]')).to_contain_text('DATA ?')
        values('V101', [0,1])
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('CONFLICT')
        values('V101', [0,1,4])
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('FAULT')
        expect(symbol('detailed').locator('[data-part="fault"]')).to_have_attribute('visibility','visible')
        values('V101', [2], [5])
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('EXTENDING')
        page.wait_for_function("document.querySelector('[id^=symbol_detailed__] [data-part=marker]').getAnimations().length === 1")
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_function("document.querySelector('[id^=symbol_detailed__] [data-part=marker]').getAnimations().length === 0")
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('EXTENDING')
        page.emulate_media(reduced_motion='no-preference')
        values('V101', [2,4])
        page.wait_for_function("document.querySelector('[id^=symbol_detailed__] [data-part=marker]').getAnimations().length === 0")
        # Identical raw values with changed quality must reach the reducer.
        values('V101', [0]); values('V101', [0], quality='stale')
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('STALE')
        values('V101', [0])
        emit('device-status:changed', dict(id=runner.DEVICE,status='connect-error'))
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('COMM_LOST')
        emit('device-status:changed', dict(id=runner.DEVICE,status='connect-ok'))
        expect(symbol('detailed').locator('[data-part="status"]')).to_have_text('WAITING')
        values('V101', [0]); values('V102', [1])
        # Keyboard opens the existing configured read-only window. Two windows of the same PLC instance.
        symbol('detailed').focus(); page.keyboard.press('Enter')
        dialogs = page.locator('app-fuxa-view-dialog')
        expect(dialogs).to_have_count(1)
        host.locator('[id^="symbol_detailed__"]').dispatch_event('click')
        expect(dialogs).to_have_count(2)
        values('V101', [2])
        for i in range(2): expect(dialogs.nth(i).locator('[data-part="status"]')).to_have_text('EXTENDING')
        ids = page.locator('app-fuxa-view [id]').evaluate_all('(nodes)=>nodes.map(n=>n.id)')
        assert len(ids) == len(set(ids)), 'Duplicate instance IDs'
        modules_before = page.evaluate('Object.keys(window).filter(k=>k.startsWith("wModule_")).length')
        dialogs.first.locator('.dialog-modal-close i').dispatch_event('click')
        expect(dialogs).to_have_count(1)
        assert page.evaluate('Object.keys(window).filter(k=>k.startsWith("wModule_")).length') == modules_before - 1
        values('V101', [1])
        expect(dialogs.first.locator('[data-part="status"]')).to_have_text('RETRACTED')
        dialogs.first.locator('.dialog-modal-close i').dispatch_event('click')
        # Measure transparency, layout boxes, geometry, truncation, and alarm-label separation.
        measurements = symbol('detailed').evaluate('''root => {
            const label=root.querySelector('[data-part=label]');
            const fault=root.querySelector('[data-part=fault]');
            const lb=label.getBBox(); const fb=fault.getBBox();
            return {labelWidth:lb.width, gap:lb.y-(fb.y+fb.height+1), background:getComputedStyle(root).backgroundColor};
        }''')
        assert measurements['labelWidth'] <= 176 and measurements['gap'] >= 4, measurements
        assert measurements['background'] == 'rgba(0, 0, 0, 0)'
        page.screenshot(path=str(Path(tempfile.gettempdir())/'nexfuxa-phase-b-runtime.png'))
        # Actual editor import, layout/metadata and exact Prefix bindings, then save/reload.
        page.goto(url + '/editor'); page.wait_for_load_state('networkidle')
        notice=page.locator('app-section-message-dialog')
        if notice.count(): notice.locator('.dialog-close-btn').click()
        wizard=page.get_by_role('button',name='CLOSE',exact=True)
        if wizard.count(): wizard.click()
        page.get_by_text('Valve Symbol Phase B',exact=True).first.click()
        page.locator('input[accept="image/png|jpg|svg"]').first.set_input_files(runner.ROOT/'custom/widgets/valves/NexFuxa_ValveSymbol.svg')
        page.wait_for_function("localStorage.getItem('NexFuxa_ValveSymbol.svg') !== null")
        page.locator('#svgroot').click(position=dict(x=760,y=300))
        page.locator('gauge-base button').click()
        panel=page.locator('flex-widget-property')
        panel.get_by_label('Symbol layout',exact=True).click(); page.get_by_role('option',name='Detailed · 192 × 184',exact=True).click()
        panel.get_by_label('Symbol label',exact=True).fill('V101 验收阀')
        panel.get_by_label('Symbol description',exact=True).fill('Phase B read-only')
        panel.get_by_label('Binding Mode',exact=True).click(); page.get_by_role('option',name='Prefix Binding',exact=True).click()
        panel.get_by_label('PLC Device',exact=True).click(); page.get_by_role('option',name='TwinCAT_ADS Fixture',exact=True).click()
        panel.get_by_label('Tag Prefix (#1)',exact=True).fill('Missing')
        expect(panel.locator('.binding-error')).to_have_count(6)
        panel.get_by_label('Tag Prefix (#1)',exact=True).fill('V101')
        expect(panel.locator('.binding-preview')).to_contain_text('t_fixture_V101_0')
        for width, height in [(1920,1080),(1366,768),(1024,768)]:
            page.set_viewport_size(dict(width=width,height=height))
            surface=page.locator('.mat-mdc-dialog-surface')
            box=surface.bounding_box()
            assert box['x'] >= -1 and box['y'] >= -1 and box['x']+box['width'] <= width+1 and box['y']+box['height'] <= height+1, box
            assert panel.locator('> .container').evaluate('(e)=>e.scrollWidth <= e.clientWidth + 1')
        panel.locator('> .container').evaluate('(e)=>e.scrollTop=0')
        panel.screenshot(path=str(Path(tempfile.gettempdir())/'nexfuxa-phase-b-properties.png'))
        page.get_by_role('button',name='OK',exact=True).click()
        page.locator('app-header button[title="Save Project"]').click()
        with page.expect_response(lambda r:r.url.endswith('/api/projectData') and r.request.post_data_json.get('cmd')=='set-view'):
            page.get_by_role('menuitem',name='Save Project',exact=True).click()
        saved=page.request.get(url+'/api/project').json()
        v=next(v for v in saved['hmi']['views'] if v['id']=='valve_symbols')
        new=next(item for key,item in v['items'].items() if key not in before['hmi']['views'][0].get('items',{}) and item['property'].get('componentUi',{}).get('metadata',{}).get('label')=='V101 验收阀')
        assert new['property']['layout']['symbolVariant']=='detailed'
        assert saved['devices'][runner.DEVICE]['tags']==before['devices'][runner.DEVICE]['tags']
        # JSON export/import of the saved View through the existing API, then reload runtime.
        assert page.request.post(url+'/api/projectData',data=dict(cmd='set-view',data=json.loads(json.dumps(v)))).ok
        page.goto(url+'/home?viewName=Valve%20Symbol%20Phase%20B'); page.wait_for_load_state('networkidle')
        emit('device-status:changed',dict(id=runner.DEVICE,status='connect-ok')); values('V101',[0])
        expect(page.locator('app-fuxa-view [aria-label^="V101 验收阀"] [data-part="status"]')).to_have_text('EXTENDED')
        assert page.evaluate('Object.keys(window).filter(k=>k.startsWith("wModule_") && window[k]?.getSnapshot).length') == page.locator('app-fuxa-view metadata[data-nexfuxa-valve-symbol]').count()
        assert not errors, errors
        assert not writes, writes
        print('Phase B browser passed: three layouts, independent values, partial/quality/disconnect/reconnect, animations/reduced motion, duplicate windows/cleanup, keyboard, editor import/Prefix/layout/metadata/save/reload/JSON roundtrip; no write frames')
        browser.close()

if __name__=='__main__':
    runner.main('valve-symbol-fixture.cjs',run_browser,broadcast_all=False)
