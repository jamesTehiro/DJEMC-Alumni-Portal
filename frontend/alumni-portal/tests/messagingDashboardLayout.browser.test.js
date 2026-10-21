import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('messaging images fit desktop/mobile and Alumni cards retain counts, scrolling and navigation', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const bundle = await build({
        stdin: { resolveDir: root, loader: 'jsx', contents: `
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {MemoryRouter, useLocation} from 'react-router-dom';
            import MessageAttachment from './src/components/MessageAttachment';
            import AlumniPage from './src/pages/Alumnipage';
            const dimensions={landscape:[3200,1800],portrait:[900,2400],square:[1400,1400],small:[320,180]};
            window.fixtureDownloads=[]; window.fixtureReads=[]; window.fixtureCalls=[];
            HTMLAnchorElement.prototype.click=function(){window.fixtureDownloads.push({name:this.download,url:this.href});};
            window.fixtureFile=async(mode,auth)=>{
                if(!auth)throw Error('Attachment authorization missing');
                window.fixtureReads.push(mode);
                if(mode==='missing')throw Error('Attachment is no longer available.');
                const [width,height]=dimensions[mode]; const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
                const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#06402b');gradient.addColorStop(1,'#e9e8d0');context.fillStyle=gradient;context.fillRect(0,0,width,height);
                context.fillStyle='white';context.font=Math.max(20,Math.min(width,height)/12)+'px sans-serif';context.fillText(mode+' image',width/12,height/2);
                return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            };
            window.fixtureGet=async(url,auth)=>{
                window.fixtureCalls.push({url,auth});
                if(url==='/jobs')return [{id:101,title:'Fixture job',description:'Latest job fixture'},{id:102,title:'Second job'}];
                if(url==='/applications')return [{id:1,Job:{title:'Applied job'},status:'pending'}];
                if(url==='/announcements')return [{id:1,title:'First announcement'},{id:2,title:'Second announcement'}];
                if(url==='/notifications')return [{id:1,isRead:false},{id:2,isRead:true}];
                throw Error('Unexpected fixture API');
            };
            function Location(){const location=useLocation();return <output data-location>{location.pathname+location.search}</output>;}
            const root=createRoot(document.getElementById('root'));
            window.show=mode=>root.render(mode==='dashboard'?<MemoryRouter><div className="dashboard-layout"><AlumniPage/><Location/></div></MemoryRouter>:<div className="dashboard-layout" data-preview-mode={mode}><MessageAttachment key={mode} message={{id:mode,file_url:mode,file_name:mode+'.png',file_mime:'image/png'}} openAttachment={()=>{throw Error('Unexpected document download');}}/></div>);
            window.show('landscape');
        ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'ui-fixture-api', setup(builder) {
            builder.onResolve({ filter: /\/services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const fetchFile=(...args)=>window.fixtureFile(...args); export const api={get:(...args)=>window.fixtureGet(...args)};' }));
        } }], logLevel: 'silent'
    });
    const css = ['node_modules/bootstrap/dist/css/bootstrap.min.css','src/index.css','src/pages/MessagesPage.css','src/pages/Alumnipage.css','src/portal-responsive.css']
        .map(file => readFileSync(path.join(root,file),'utf8')).join('\n') + '\n*,*::before,*::after{transition:none!important;animation:none!important;}';
    const server = createServer((req,res) => {
        if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].text); }
        else if (req.url === '/styles.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
        else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ headless:true, pipe:true, executablePath:process.env.PUPPETEER_EXECUTABLE_PATH });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const screenshots = path.join(root,'../../tmp/messaging-dashboard-ui'); mkdirSync(screenshots,{recursive:true});
        for (const viewport of process.env.UI_LAYOUT_DASHBOARD_ONLY === '1' ? [] : [{width:1440,height:900},{width:820,height:1180},{width:390,height:844},{width:844,height:390},{width:320,height:568}]) {
            await page.setViewport(viewport);
            for (const mode of ['landscape','portrait','square','small']) {
                await page.evaluate(mode=>window.show(mode),mode);
                await page.waitForFunction(mode=>document.querySelector('[data-preview-mode]')?.getAttribute('data-preview-mode')===mode,{},mode);
                await page.waitForFunction(()=>{
                    const button=document.querySelector('.attachment-image-button'), image=button?.querySelector('img');
                    return button&&!button.disabled&&button.getBoundingClientRect().width>0&&image?.complete&&image.naturalWidth>0;
                });
                await page.click('.attachment-image-button');
                await page.waitForFunction(()=>document.querySelector('.message-image-lightbox img')?.naturalWidth>0);
                const bounds=await page.evaluate(()=>{
                    const image=document.querySelector('.message-image-lightbox img'), modal=document.querySelector('.message-image-preview-content'), body=document.querySelector('.message-image-preview-body');
                    const box=image.getBoundingClientRect(), frame=modal.getBoundingClientRect();
                    return {width:box.width,height:box.height,ratio:image.naturalWidth/image.naturalHeight,frameWidth:frame.width,left:frame.left,right:frame.right,top:frame.top,bottom:frame.bottom,scrolls:body.scrollWidth>body.clientWidth+1||body.scrollHeight>body.clientHeight+1,links:modal.querySelectorAll('a').length,buttons:[...modal.querySelectorAll('button')].map(button=>button.textContent)};
                });
                console.log(JSON.stringify({viewport,mode,...bounds}));
                assert.ok(Math.abs(bounds.width/bounds.height-bounds.ratio)<0.01,'image aspect ratio is preserved');
                assert.ok(bounds.left>=-1&&bounds.right<=viewport.width+1&&bounds.top>=-1&&bounds.bottom<=viewport.height+1,'modal stays within viewport');
                assert.ok(bounds.frameWidth-bounds.width<=18||bounds.frameWidth<=220,'image determines modal width, with only a compact header minimum for narrow images');
                assert.equal(bounds.scrolls,false); assert.equal(bounds.links,0);
                assert.equal(bounds.buttons.some(text=>/Enlarge image/.test(text)),false);
                assert.ok(bounds.width>0&&bounds.height>0);
                if (viewport.width===1440||viewport.width===390) await page.screenshot({path:path.join(screenshots,`image-${mode}-${viewport.width}.png`)});
                const before=await page.evaluate(()=>window.fixtureDownloads.length);
                await page.click('button[aria-label="Download image"]');
                assert.equal(await page.evaluate(()=>window.fixtureDownloads.length),before+1);
                assert.equal(await page.evaluate(()=>window.fixtureDownloads.at(-1).name),mode+'.png');
                await page.click('.message-image-preview-header .btn-close');
                await page.waitForFunction(()=>!document.querySelector('.message-image-preview-dialog'));
            }
        }
        await page.evaluate(()=>window.show('missing'));
        await page.waitForSelector('.attachment-image-fallback');
        assert.match(await page.$eval('.attachment-image-fallback',node=>node.textContent),/no longer available/);
        await page.setViewport({width:1440,height:900});
        await page.evaluate(()=>window.show('dashboard'));
        await page.waitForFunction(()=>document.querySelector('.alu-dash-card-count')?.textContent==='2');
        assert.deepEqual(await page.$$eval('.alu-dash-card-label',nodes=>nodes.map(node=>node.textContent)),['Available Jobs','Applications','Announcements']);
        assert.deepEqual(await page.$$eval('.alu-dash-card-count',nodes=>nodes.map(node=>node.textContent)),['2','1','2']);
        await page.waitForSelector('.welcome-badge');
        assert.equal(await page.$eval('.welcome-badge',node=>node.textContent),'1');
        for (const viewport of [{width:1440,height:900},{width:820,height:1180},{width:390,height:844},{width:600,height:900}]) {
            await page.setViewport(viewport);
            await page.mouse.move(0,0);
            const layout=await page.evaluate(()=>{
                const group=document.querySelector('.alu-dash-metrics'), cards=[...group.children].map(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height,top:box.top};});
                return {groupWidth:group.clientWidth,scrollWidth:group.scrollWidth,gap:parseFloat(getComputedStyle(group).columnGap),display:getComputedStyle(group).display,overflowX:getComputedStyle(group).overflowX,cards,pageOverflow:document.documentElement.scrollWidth>innerWidth};
            });
            console.log(JSON.stringify({viewport,dashboard:layout}));
            assert.equal(layout.cards.length,3); assert.equal(layout.pageOverflow,false);
            assert.ok(layout.cards.every(card=>Math.abs(card.top-layout.cards[0].top)<1),'cards share one row');
            if(viewport.width>=768) {
                assert.ok(Math.abs(layout.cards.reduce((sum,card)=>sum+card.width,0)+2*layout.gap-layout.groupWidth)<2,'three cards fill the row');
                assert.ok(layout.cards.every(card=>Math.abs(card.width-layout.cards[0].width)<1&&card.height===layout.cards[0].height));
            } else {
                assert.equal(layout.display,'flex'); assert.equal(layout.overflowX,'auto');
                if(viewport.width<430) {
                    assert.ok(layout.scrollWidth>layout.groupWidth,'narrow mobile cards scroll horizontally');
                    assert.ok(await page.$eval('.alu-dash-metrics',node=>{node.scrollLeft=node.scrollWidth;return node.scrollLeft>0;}));
                }
            }
            if(viewport.width===1440||viewport.width===390) await page.screenshot({path:path.join(screenshots,`dashboard-${viewport.width}.png`),fullPage:true});
        }
        await page.setViewport({width:1440,height:900});
        await page.click('.alu-dash-card:nth-child(2)'); await page.waitForSelector('.alu-dash-panel h3');
        assert.equal(await page.$eval('.alu-dash-panel h3',node=>node.textContent),'My Applications');
        await page.click('.alu-dash-card:nth-child(3)');
        assert.equal(await page.$eval('.alu-dash-panel h3',node=>node.textContent),'Announcements');
        await page.click('.alu-dash-card:nth-child(1)');
        assert.equal(await page.$eval('.alu-dash-panel h3',node=>node.textContent),'Latest Job Opportunities');
        await page.click('.alu-job-footer-link');
        assert.equal(await page.$eval('[data-location]',node=>node.textContent),'/jobs?jobId=101');
        await page.click('.welcome-bell');
        assert.equal(await page.$eval('[data-location]',node=>node.textContent),'/notifications');
        await page.click('.alu-view-all');
        assert.equal(await page.$eval('[data-location]',node=>node.textContent),'/jobs');
        await page.focus('.welcome-bell'); await page.keyboard.press('Enter');
        assert.equal(await page.$eval('[data-location]',node=>node.textContent),'/notifications');
        assert.ok(await page.evaluate(()=>window.fixtureCalls.some(call=>call.url==='/notifications'&&call.auth===true)));
        assert.deepEqual(errors,[]);
    } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});
