"""Editor delete/undo ownership regression using actual Angular and isolated SQLite."""
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('widget-prefix-e2e.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def run_browser(url, server):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=dict(width=1366, height=768))
        page.add_init_script("""(() => {
            const listeners = new Set();
            const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
            document.addEventListener = (type, fn, ...args) => { if(type === 'visibilitychange') listeners.add(fn); return add(type, fn, ...args); };
            document.removeEventListener = (type, fn, ...args) => { if(type === 'visibilitychange') listeners.delete(fn); return remove(type, fn, ...args); };
            window.editorVisibilityListeners = () => listeners.size;
            const resize = new Set(), addWindow = window.addEventListener.bind(window), removeWindow = window.removeEventListener.bind(window);
            window.addEventListener = (type, fn, ...args) => { if(type === 'resize') resize.add(fn); return addWindow(type, fn, ...args); };
            window.removeEventListener = (type, fn, ...args) => { if(type === 'resize') resize.delete(fn); return removeWindow(type, fn, ...args); };
            window.editorResizeListeners = () => resize.size;
            const matchMedia = window.matchMedia.bind(window), media = new Set();
            window.matchMedia = query => {
                const m = matchMedia(query), add = m.addEventListener.bind(m), remove = m.removeEventListener.bind(m);
                m.addEventListener = (type, fn, ...args) => { if(query === '(prefers-reduced-motion: reduce)' && type === 'change') media.add(fn); return add(type, fn, ...args); };
                m.removeEventListener = (type, fn, ...args) => { if(query === '(prefers-reduced-motion: reduce)' && type === 'change') media.delete(fn); return remove(type, fn, ...args); };
                return m;
            };
            window.editorMediaListeners = () => media.size;
        })();""")
        errors, writes = [], []
        page.on('websocket', lambda ws: ws.on('framesent', lambda frame: writes.append(frame) if 'device-values' in str(frame) and 'set' in str(frame) else None))
        initial_devices = page.request.get(url + '/api/project').json()['devices']
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url + '/editor')
        page.wait_for_load_state('networkidle')
        notice = page.get_by_role('button', name='CLOSE', exact=True)
        if notice.count():
            notice.click()
        page.get_by_text('Valve Symbol Phase B', exact=True).first.click()
        page.locator('input[accept="image/png|jpg|svg"]').first.set_input_files(runner.ROOT / 'custom/widgets/valves/NexFuxa_ValveSymbol.svg')
        page.wait_for_function("localStorage.getItem('NexFuxa_ValveSymbol.svg') !== null")
        page.locator('#svgroot').click(position=dict(x=760, y=300))
        expect(page.locator('#svgroot metadata[data-nexfuxa-valve-symbol]')).to_have_count(1)
        page.locator('gauge-base button').click()
        panel = page.locator('flex-widget-property')
        panel.get_by_label('Symbol layout', exact=True).click()
        page.get_by_role('option', name='Detailed · 192 × 184', exact=True).click()
        panel.get_by_label('Symbol label', exact=True).fill('Lifecycle V101')
        panel.get_by_label('Symbol description', exact=True).fill('Preserved across history')
        panel.get_by_label('Binding Mode', exact=True).click()
        page.get_by_role('option', name='Prefix Binding', exact=True).click()
        panel.get_by_label('PLC Device', exact=True).click()
        page.get_by_role('option', name='TwinCAT_ADS Fixture', exact=True).click()
        panel.get_by_label('Tag Prefix (#1)', exact=True).fill('V101')
        page.get_by_role('button', name='OK', exact=True).click()
        gauge_id = page.locator('#svgroot metadata[data-nexfuxa-valve-symbol]').evaluate("n => n.closest('g[type=\"svg-ext-own_ctrl-image\"]').id")
        def module_key():
            return page.locator(f'#{gauge_id} [data-fuxa-module]').get_attribute('data-fuxa-module')

        def animate():
            key = module_key()
            page.evaluate("""key => {
                const m = window[key];
                for(const name of ['extended','retracted','extending','retracting','error','isManualMode'])
                    m.putValue('_pb_' + name, name === 'extending');
                m.setContext({connected:true});
            }""", key)
            expect(page.locator(f'#{gauge_id} [data-part="status"]')).to_have_text('EXTENDING')
            page.wait_for_function("id => document.getElementById(id).querySelector('[data-part=marker]').getAnimations().length === 1", arg=gauge_id)
            return key

        def save():
            page.locator('app-header button[title="Save Project"]').click()
            with page.expect_response(lambda r: r.url.endswith('/api/projectData') and r.request.post_data_json.get('cmd') == 'set-view'):
                page.get_by_role('menuitem', name='Save Project', exact=True).click()
            return next(v for v in page.request.get(url + '/api/project').json()['hmi']['views'] if v['id'] == 'valve_symbols')

        initial = save()['items'][gauge_id]['property']
        # Test an actual moving runtime; preserve a reference to the detached marker to detect stale animations.
        base_modules = page.evaluate('Object.keys(window).filter(k=>k.startsWith("wModule_")).length')
        base_listeners = page.evaluate('window.editorVisibilityListeners()')
        base_media = page.evaluate('window.editorMediaListeners()')
        for cycle in range(6):
            key = animate()
            page.evaluate("id => window.deletedValveMarker = document.getElementById(id).querySelector('[data-part=marker]')", gauge_id)
            page.evaluate("id => window.svgCanvas.selectOnly([document.getElementById(id)])", gauge_id)
            page.locator('#tool_delete').click()
            expect(page.locator(f'#{gauge_id}')).to_have_count(0)
            assert page.evaluate('(key) => !window[key]', key), 'deleted Valve module remains alive'
            assert page.evaluate('window.deletedValveMarker.getAnimations().length') == 0
            assert page.evaluate('window.editorVisibilityListeners()') == base_listeners - 1
            assert page.evaluate('window.editorMediaListeners()') == base_media - 1
            if cycle == 0:
                assert gauge_id not in save()['items'], 'Save persisted deleted equipment'
            page.locator('#tool_undo').click()
            expect(page.locator(f'#{gauge_id} metadata[data-nexfuxa-valve-symbol]')).to_have_count(1)
            restored_key = module_key()
            assert page.evaluate('(key) => !!window[key]?.getSnapshot', restored_key), 'Undo restored SVG but not the Valve runtime'
            assert page.evaluate('window.editorVisibilityListeners()') == base_listeners
            assert page.evaluate('window.editorMediaListeners()') == base_media
            assert page.evaluate('Object.keys(window).filter(k=>k.startsWith("wModule_")).length') == base_modules
            animate()
            page.locator('#tool_redo').click()
            expect(page.locator(f'#{gauge_id}')).to_have_count(0)
            assert page.evaluate('(key) => !window[key]', restored_key)
            page.locator('#tool_undo').click()
            expect(page.locator(f'#{gauge_id}')).to_have_count(1)
        # A real dynamically created Angular Gauge owns a window HostListener.
        # Removing only its DOM or manually invoking ngOnDestroy would leave that listener alive.
        resize_baseline = page.evaluate('window.editorResizeListeners()')
        page.evaluate("window.svgEditor.clickToSetMode('html_bag')")
        page.locator('#svgroot').click(position=dict(x=300, y=450))
        expect(page.locator('#svgroot ngx-gauge')).to_have_count(1)
        bag_id = page.locator('#svgroot ngx-gauge').evaluate("n => n.closest('g[type=\"svg-ext-html_bag\"]').id")
        page.evaluate("window.svgEditor.clickToSetMode('select')")
        active_resize = page.evaluate('window.editorResizeListeners()')
        assert active_resize > resize_baseline
        for cycle in range(3):
            assert page.evaluate('window.editorResizeListeners()') == active_resize
            page.evaluate('id => window.svgCanvas.selectOnly([document.getElementById(id)])', bag_id)
            page.locator('#tool_delete').click()
            expect(page.locator('#svgroot ngx-gauge')).to_have_count(0)
            assert page.evaluate('window.editorResizeListeners()') == resize_baseline
            page.locator('#tool_undo').click()
            try:
                expect(page.locator('#svgroot ngx-gauge')).to_have_count(1)
            except AssertionError:
                print('Angular Undo diagnostic', cycle, errors, page.locator('#' + bag_id).evaluate_all('(nodes)=>nodes.map(n=>n.outerHTML)'), flush=True)
                raise
        assert page.evaluate('window.editorResizeListeners()') == active_resize
        restored = save()['items'][gauge_id]['property']
        for field in ['bindingProfile', 'prefixBinding', 'componentUi', 'layout', 'varsToBind']:
            if field in initial:
                # Runtime export names/IDs may be regenerated; binding declarations remain unchanged.
                if field == 'varsToBind':
                    assert [(v['originalName'], v.get('variableId'), v.get('variableValue')) for v in restored[field]] == [(v['originalName'], v.get('variableId'), v.get('variableValue')) for v in initial[field]]
                else:
                    assert restored[field] == initial[field]
        key = animate()
        page.get_by_text('Symbol Read-only Detail', exact=True).first.click()
        expect(page.locator(f'#{gauge_id}')).to_have_count(0)
        assert page.evaluate('(key) => !window[key]', key), 'View switch retained the old module'
        page.get_by_text('Valve Symbol Phase B', exact=True).first.click()
        expect(page.locator(f'#{gauge_id}')).to_have_count(1)
        key = animate()
        # Use real Angular routing so Editor.ngOnDestroy runs without a full browser reload.
        links = page.locator('a[href="home"], a[href="/home"]')
        if links.count():
            links.first.click()
        else:
            page.evaluate("history.pushState({}, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate'))")
        expect(page.locator('app-editor')).to_have_count(0)
        assert page.evaluate('(key) => !window[key]', key), 'Editor Destroy retained the old module'
        page.evaluate('delete window.deletedValveMarker')
        assert not errors, errors
        assert not writes, writes
        assert page.request.get(url + '/api/project').json()['devices'] == initial_devices
        browser.close()
        print('PASS editor Delete/Undo/Redo/Save/View Switch/Editor Destroy: Valve behavior, detached animations, module/listener bounds, real Angular host listener disposal and configuration preservation')


if __name__ == '__main__':
    runner.main('valve-symbol-fixture.cjs', run_browser, broadcast_all=False)
