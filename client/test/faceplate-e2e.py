"""Production Angular, filtered Socket.IO and a restarted temporary SQLite server; no PLC."""
import importlib.util
import json
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('widget-prefix-e2e.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def run_browser(url, server, editor=True):
    def emit(event, payload):
        server.stdin.write(json.dumps(dict(event=event, payload=payload)) + '\n')
        server.stdin.flush()

    def values(prefix, active):
        emit('device-value:changed', dict(id=runner.DEVICE, values=[dict(id=f't_fixture_{prefix}_{i}', value=i in active) for i in range(6)]))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1600, height=1100), locale='en-US')
        errors, writes = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('websocket', lambda ws: ws.on('framesent', lambda data: writes.append(data) if '"cmd":"set"' in str(data) else None))
        initial = page.request.get(url + '/api/project').json()
        page.goto(url + '/home?viewName=Faceplate%20Prefix%20Fixture')
        page.wait_for_load_state('networkidle')
        host = page.locator('app-home app-fuxa-view').first
        dialogs = page.locator('app-fuxa-view-dialog app-fuxa-view')
        cards = page.locator('.fab-card > app-fuxa-view')

        def open_source(id, card=False):
            views = cards if card else dialogs
            count = views.count()
            host.locator(f'[id^="{id}__view_instance_"]').dispatch_event('click')
            expect(views).to_have_count(count + 1)
            expect(views.last.locator('[id^="feedback__"] [id^="statusText_"]')).to_have_count(1)
            return views.last

        def text(view, widget='feedback', field='statusText_'):
            return view.locator(f'[id^="{widget}__view_instance_"] [id^="{field}"]')

        def close(index=0, card=False):
            views = cards if card else dialogs
            count = views.count()
            selector = '.fab-card .card-close' if card else 'app-fuxa-view-dialog .dialog-modal-close i'
            page.locator(selector).nth(index).dispatch_event('click')
            expect(views).to_have_count(count - 1)

        open_source('d101'); open_source('d102')
        emit('device-status:changed', dict(id=runner.DEVICE, status='connect-ok'))
        values('V101', {0, 5}); values('V102', {1})
        for widget in ['feedback', 'secondary']:
            expect(text(dialogs.nth(0), widget)).to_have_text('EXTENDED')
            expect(text(dialogs.nth(1), widget)).to_have_text('RETRACTED')
        expect(text(dialogs.nth(0), field='manualText_')).to_have_text('MANUAL')
        expect(text(dialogs.nth(1), field='manualText_')).to_have_text('AUTO')
        for index in range(2):
            expect(text(dialogs.nth(index), 'fixed')).to_have_text('RETRACTED')
            expect(text(dialogs.nth(index), 'manual')).to_have_text('EXTENDED')
            expect(dialogs.nth(index).get_by_role('alert')).to_have_count(0)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-faceplate-runtime.png'))
        dialogs.nth(0).locator('[id^="secondary__view_instance_"]').dispatch_event('click')
        expect(dialogs).to_have_count(3)
        values('V101', {0,5})
        expect(text(dialogs.nth(2))).to_have_text('EXTENDED')
        expect(text(dialogs.nth(1))).to_have_text('RETRACTED')
        close(2)
        for active, state in [({0,1,4},'FAULT'), ({0,1},'CONFLICT'), ({2},'EXTENDING'), ({3},'RETRACTING')]:
            values('V101', active)
            expect(text(dialogs.nth(0))).to_have_text(state)
            expect(text(dialogs.nth(1))).to_have_text('RETRACTED')
        emit('device-value:changed', dict(id=runner.DEVICE, values=[dict(id='t_fixture_V101_5', value=None)]))
        expect(text(dialogs.nth(0))).to_have_text('WAITING FOR DATA')
        expect(text(dialogs.nth(1))).to_have_text('RETRACTED')
        emit('device-status:changed', dict(id=runner.DEVICE, status='connect-error'))
        for index in range(2): expect(text(dialogs.nth(index))).to_have_text('WAITING FOR DATA')
        emit('device-status:changed', dict(id=runner.DEVICE, status='connect-ok'))
        values('V101', {0}); values('V102', {1})
        expect(text(dialogs.nth(0))).to_have_text('EXTENDED')
        expect(text(dialogs.nth(1))).to_have_text('RETRACTED')
        close(0)
        values('V102', {0})
        expect(text(dialogs.first)).to_have_text('EXTENDED')
        open_source('d101')
        values('V101', {1})
        expect(text(dialogs.nth(1))).to_have_text('RETRACTED')
        close(0)
        values('V101', {0})
        expect(text(dialogs.first)).to_have_text('EXTENDED')
        open_source('d101')  # two instances sharing the same Tags
        values('V101', {1})
        for index in range(2): expect(text(dialogs.nth(index))).to_have_text('RETRACTED')
        close(); close()
        open_source('c101', True); open_source('c102', True)
        values('V101', {0}); values('V102', {1})
        expect(text(cards.nth(0))).to_have_text('EXTENDED')
        expect(text(cards.nth(1))).to_have_text('RETRACTED')
        close(card=True)
        open_source('d101')
        values('V102', {0})
        expect(text(cards.first)).to_have_text('EXTENDED')
        emit('fixture-disconnect', {})
        page.wait_for_timeout(2200)
        values('V101', {1}); values('V102', {1})
        expect(text(dialogs.first)).to_have_text('RETRACTED')
        expect(text(cards.first)).to_have_text('RETRACTED')
        close(); close(card=True)
        for source, message in [('no_context','Missing Faceplate Binding Context'), ('bad_device','PLC Device does not exist'),
                                ('bad_tag','Missing Tag'), ('bad_parameter','Missing parameter')]:
            view = open_source(source)
            expect(view.get_by_role('alert')).to_contain_text(message)
            for widget in ['feedback','secondary']: expect(text(view,widget)).to_have_text('WAITING FOR DATA')
            values('V102', {0})
            expect(text(view,'fixed')).to_have_text('EXTENDED')
            close()
        def resources():
            return page.evaluate('''() => ({views:document.querySelectorAll('app-fuxa-view').length,
                modules:Object.keys(window).filter(k=>k.startsWith('wModule_')).length,
                activeModules:Object.keys(window).filter(k=>k.startsWith('wModule_')&&window[k]).length,
                ids:document.querySelectorAll('app-fuxa-view [id]').length})''')
        baseline = resources()
        for _ in range(20):
            open_source('d101')
            values('V101', {0})
            expect(text(dialogs.first)).to_have_text('EXTENDED')
            close()
        assert resources() == baseline, (baseline, resources())
        emit('fixture-assert-tags', [f't_fixture_{prefix}_{i}' for prefix in ['V101','V102'] for i in range(6)])
        ids = page.locator('app-fuxa-view [id]').evaluate_all('(nodes)=>nodes.map(n=>n.id)')
        assert len(ids) == len(set(ids))
        after = page.request.get(url + '/api/project').json()
        assert initial['hmi']['views'] == after['hmi']['views']
        assert initial['devices'] == after['devices']
        if editor:
            page.goto(url + '/editor')
            page.wait_for_load_state('networkidle')
            notice = page.locator('app-section-message-dialog')
            if notice.count(): notice.locator('.dialog-close-btn').click()
            wizard = page.get_by_role('button', name='CLOSE', exact=True)
            if wizard.count(): wizard.click()
            page.get_by_text('Valve.Faceplate', exact=True).first.click()
            page.locator('#feedback').click(position=dict(x=20,y=20))
            page.locator('gauge-base button').click()
            panel = page.locator('flex-widget-property')
            expect(panel.get_by_label('Binding Mode', exact=True)).to_contain_text('Inherit Faceplate Binding')
            panel.get_by_label('Binding Mode', exact=True).click()
            page.get_by_role('option', name='Prefix Binding', exact=True).click()
            panel.get_by_label('PLC Device', exact=True).click()
            page.get_by_role('option', name='TwinCAT_ADS Fixture', exact=True).click()
            panel.get_by_label('Tag Prefix (#1)', exact=True).fill('V101')
            panel.get_by_label('Binding Mode', exact=True).click()
            page.get_by_role('option', name='Inherit Faceplate Binding', exact=True).click()
            expect(panel.get_by_label('PLC Device', exact=True)).to_have_count(0)
            expect(panel.locator('.var-ref:visible')).to_have_count(1)
            panel.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-faceplate-property.png'))
            page.get_by_role('tab', name='Events', exact=True).click()
            page.locator('flex-event .my-form-field mat-select').nth(1).click()
            expect(page.get_by_role('option', name='Open Faceplate (Dialog)', exact=True)).to_have_count(1)
            expect(page.get_by_role('option', name='Open Faceplate (Card)', exact=True)).to_have_count(1)
            page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-faceplate-actions.png'))
            page.keyboard.press('Escape')
            page.get_by_role('button', name='OK', exact=True).click()
            page.locator('app-header button[title="Save Project"]').click()
            with page.expect_response(lambda response: response.url.endswith('/api/projectData') and response.request.post_data_json.get('cmd') == 'set-view'):
                page.get_by_role('menuitem', name='Save Project', exact=True).click()
            saved = page.request.get(url + '/api/project').json()
            shared = next(v for v in saved['hmi']['views'] if v['id'] == 'faceplate_prefix')
            inherited = shared['items']['feedback']['property']
            assert inherited['inheritFaceplateBinding'] is True
            assert 'prefixBinding' not in inherited
            for variable in inherited['varsToBind']:
                if variable['originalName'] in inherited['bindingProfile']['bindings']:
                    assert not variable.get('variableId') and not variable.get('variableValue')
            assert initial['devices'] == saved['devices']
        assert not errors, errors
        assert not writes, writes
        browser.close()
        print('PASS faceplate inheritance: no mapping, two inherited Widgets, fixed/manual compatibility, six BOOL validity, priority/mode, Dialog/Card, errors, disconnect/reconnect, 20 cycles, SQLite save/reload; baseline=',baseline)


if __name__ == '__main__':
    runner.main('faceplate-fixture.cjs', run_browser, False, lazy=True,
                restart_runner=lambda url, server: run_browser(url, server, editor=False))
