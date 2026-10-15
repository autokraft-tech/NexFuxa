"""Real production Angular + filtered Socket.IO + disposable SQLite. No PLC writes."""
import importlib.util
import json
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('fixture_runner', Path(__file__).with_name('widget-prefix-e2e.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def run_browser(url, server):
    def emit(event, payload):
        server.stdin.write(json.dumps(dict(event=event, payload=payload)) + '\n')
        server.stdin.flush()

    def values(prefix, active):
        emit('device-value:changed', dict(id=runner.DEVICE, values=[dict(id=f't_fixture_{prefix}_{i}', value=i == active) for i in range(6)]))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1400, height=1000), locale='en-US')
        page.add_init_script('''(() => {
            const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
            const tracked = new WeakMap();
            window.__activeViewSvgListeners = 0;
            EventTarget.prototype.addEventListener = function(type, listener, options) {
                if (this instanceof SVGElement && this.closest('app-fuxa-view')) {
                    const key = type + ':' + Boolean(typeof options === 'boolean' ? options : options?.capture);
                    if (!tracked.has(this)) tracked.set(this, new Map());
                    const events = tracked.get(this);
                    if (!events.has(key)) events.set(key, new Set());
                    if (!events.get(key).has(listener)) { events.get(key).add(listener); ++window.__activeViewSvgListeners; }
                }
                return add.call(this, type, listener, options);
            };
            EventTarget.prototype.removeEventListener = function(type, listener, options) {
                const key = type + ':' + Boolean(typeof options === 'boolean' ? options : options?.capture);
                if (tracked.get(this)?.get(key)?.delete(listener)) --window.__activeViewSvgListeners;
                return remove.call(this, type, listener, options);
            };
        })();''')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        before = page.request.get(url + '/api/project').json()
        page.goto(url + '/home?viewName=Instance%20Fixture')
        page.wait_for_load_state('networkidle')
        host = page.locator('app-home app-fuxa-view').first
        if not host.count():
            host = page.locator('app-fuxa-view').first
        def click(name):
            old_count = page.locator('app-fuxa-view-dialog').count()
            # Material's modal backdrop blocks physical clicks on the host while a dialog is open.
            host.locator(f'[id^="{name}__view_instance_"]').first.dispatch_event('click')
            if name in ['da', 'db', 'same']:
                expect(page.locator('app-fuxa-view-dialog')).to_have_count(old_count + 1)
                expect(page.locator('app-fuxa-view-dialog').last.locator('[id^="statusText_"]')).to_have_count(1)
        dialogs = page.locator('app-fuxa-view-dialog app-fuxa-view')
        cards = page.locator('.fab-card > app-fuxa-view')
        def status(view):
            return view.locator('[id^="statusText_"]')
        def close_dialog(index=0):
            count = dialogs.count()
            page.locator('app-fuxa-view-dialog .dialog-modal-close i').nth(index).dispatch_event('click')
            expect(dialogs).to_have_count(count - 1)
        def close_card(index=0):
            page.locator('.fab-card .card-close').nth(index).dispatch_event('click')
        def live(a, b):
            values('V101', 0)
            values('V102', 1)
            expect(status(a)).to_have_text('EXTENDED')
            expect(status(b)).to_have_text('RETRACTED')
            if errors: raise AssertionError(errors)
            expect(a.locator('[id^="I-HXI_value__"]')).to_have_value('1')
            expect(b.locator('[id^="I-HXI_value__"]')).to_have_value('0')
            expect(a.locator('chart-uplot')).to_have_count(1)
            expect(b.locator('app-data-table')).to_have_count(1)
            values('V101', 1)
            expect(status(a)).to_have_text('RETRACTED')
            expect(status(b)).to_have_text('RETRACTED')

        click('da'); click('db')
        expect(dialogs).to_have_count(2)
        live(dialogs.nth(0), dialogs.nth(1))
        dialogs.nth(0).locator('[id^="script__"]').dispatch_event('click')
        expect(dialogs.nth(0).locator('chart-uplot')).to_contain_text('Local script executed')
        expect(dialogs.nth(1).locator('chart-uplot')).not_to_contain_text('Local script executed')
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-view-instance-dialogs.png'))
        close_dialog(0)
        values('V102', 0)
        expect(status(dialogs.first)).to_have_text('EXTENDED')
        dialogs.first.locator('[id^="script__"]').dispatch_event('click')
        expect(dialogs.first.locator('chart-uplot')).to_contain_text('Local script executed')
        click('da')
        live(dialogs.nth(1), dialogs.nth(0))
        close_dialog(0)
        values('V101', 0)
        expect(status(dialogs.first)).to_have_text('EXTENDED')
        click('same')
        values('V101', 1)
        for index in range(2): expect(status(dialogs.nth(index))).to_have_text('RETRACTED')
        close_dialog(0)
        values('V101', 0)
        expect(status(dialogs.first)).to_have_text('EXTENDED')
        close_dialog()

        click('ca'); click('cb')
        expect(cards).to_have_count(2)
        click('ca')
        expect(cards).to_have_count(2)  # same trigger remains single
        live(cards.nth(0), cards.nth(1))
        close_card(0)
        values('V102', 0)
        expect(status(cards.first)).to_have_text('EXTENDED')
        click('da')
        live(dialogs.first, cards.first)
        close_card()
        values('V101', 0)
        expect(status(dialogs.first)).to_have_text('EXTENDED')
        # Panel, main page and modal render the same definition concurrently.
        expect(host.locator('[id^="panel__"] app-fuxa-view [id^="statusText_"]')).to_have_count(1)
        ids = page.locator('app-fuxa-view [id]').evaluate_all('(nodes) => nodes.map(n => n.id)')
        assert len(ids) == len(set(ids)), ['duplicate runtime DOM IDs', sorted({id for id in ids if ids.count(id) > 1})]
        assert page.locator('[id^="decor__"]').first.get_attribute('fill').startswith('url(#paint__view_instance_')
        assert page.locator('[id^="decor__"]').first.evaluate('(node)=>getComputedStyle(node).stroke') == 'rgb(255, 255, 255)'
        # Reconnect the actual Socket.IO transport, preserving mounted views.
        emit('fixture-disconnect', {})
        page.wait_for_timeout(2200)
        values('V101', 1)
        expect(status(dialogs.first)).to_have_text('RETRACTED')
        close_dialog()
        click('ca'); click('cb')
        expect(cards).to_have_count(2)
        click('single')
        expect(cards).to_have_count(1)
        close_card()
        expect(cards).to_have_count(0)
        def resources():
            return page.evaluate('''() => ({views: document.querySelectorAll('app-fuxa-view').length,
                modules: Object.keys(window).filter(k => k.startsWith('wModule_') && window[k]).length,
                moduleKeys: Object.keys(window).filter(k => k.startsWith('wModule_')).length,
                svgListeners: window.__activeViewSvgListeners,
                ids: document.querySelectorAll('app-fuxa-view [id]').length})''')
        baseline = resources()
        emit('fixture-assert-tags', [])
        for _ in range(20):
            click('da')
            expect(dialogs).to_have_count(1)
            values('V101', 0)
            expect(status(dialogs.first)).to_have_text('EXTENDED')
            dialogs.first.locator('[id^="close__view_instance_"]').dispatch_event('click')
            expect(dialogs).to_have_count(0)
        assert resources() == baseline, (baseline, resources())
        emit('fixture-assert-tags', [])
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'nexfuxa-view-instance.png'))
        # Hold a real lazy-view HTTP response while the originating render navigates away.
        pending = []
        page.route('**/api/project/view/slowface', lambda route: pending.append(route))
        with page.expect_request('**/api/project/view/slowface'):
            click('slow')
        click('nav')
        expect(host.locator('[id^="da__"]')).to_have_count(0)
        expect(host.locator('[id^="statusText_"]')).to_have_count(1)
        assert len(pending) == 1
        slow_view = next(view for view in before['hmi']['views'] if view['id'] == 'slowface')
        pending[0].fulfill(json=slow_view)
        page.wait_for_load_state('networkidle')
        expect(dialogs).to_have_count(0)
        values('V101', 1)
        expect(status(host)).to_have_text('RETRACTED')
        after = page.request.get(url + '/api/project').json()
        assert before['hmi']['views'] == after['hmi']['views'], 'runtime clone persisted'
        assert before['devices'] == after['devices'], 'Tag configuration changed'
        assert before['charts'] == after['charts'], 'Chart definition changed'
        assert before['scripts'] == after['scripts'], 'Script definition changed'
        assert not errors, errors
        print('PASS: dialogs/cards/mixed/panel, different/shared tags, close/reopen both orders, DOM references, reconnect, 20 cycles, unchanged SQLite definitions; baseline=', baseline)
        browser.close()


if __name__ == '__main__':
    runner.main('view-instance-fixture.cjs', run_browser, False, lazy=True)
