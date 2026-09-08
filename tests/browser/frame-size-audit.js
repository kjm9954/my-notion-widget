// Isolated fixture for actual widget-frame.js; no production data or API.
async (page) => {
  const cases=[
    {name:'small original',width:390,base:300,height:128,mode:'scale',visual:300},
    {name:'saved small scale',width:390,base:1350,height:600,saved:{contentW:1400,scale:.5,frameH:600},mode:'scale',visual:390},
    {name:'large phone dedicated',width:390,base:1350,height:600,saved:{contentW:1400,scale:1,frameH:600},mobile:true,mode:'mobile',visual:390},
    {name:'large phone generic',width:390,base:940,height:600,saved:{contentW:940,scale:1,frameH:600},mode:'reflow',visual:390},
    {name:'tablet tall saved frame',width:820,base:1400,height:1800,saved:{contentW:1400,scale:1,frameH:1800},mobile:true,mode:'scale',visual:820},
    {name:'shared key absent uses own size',width:390,base:940,height:800,saved:{contentW:1200,scale:.5,frameH:800},shared:true,mode:'scale',visual:390},
    {name:'shared tall frame ignores viewport height',width:820,base:940,height:1800,saved:{contentW:1200,scale:.5,frameH:1800},shared:true,sharedSize:{visualW:600,scale:.5},mode:'scale',visual:600},
    {name:'legacy width and height',width:390,base:1000,height:600,saved:{width:700,height:420},mode:'scale',visual:390},
    {name:'narrow desktop keeps saved width',width:390,base:1400,height:600,saved:{contentW:1400,scale:1,frameH:600},desktop:true,mode:'desktop',visual:1400}
  ];
  const results=[];
  for(const item of cases){
    const context=await page.context().browser().newContext({viewport:{width:item.width,height:700},isMobile:!item.desktop,hasTouch:!item.desktop,deviceScaleFactor:1,reducedMotion:'reduce'});
    await context.addInitScript(item=>{
      const put=Storage.prototype.setItem;
      if(item.saved)put.call(localStorage,'widget-size-qa.html',JSON.stringify(item.saved));
      if(item.sharedSize)put.call(localStorage,'widget-width-qa',JSON.stringify(item.sharedSize));
      window.__sizeWrites=[];
      window.__seed=(key,value)=>put.call(localStorage,key,JSON.stringify(value));
      Storage.prototype.setItem=function(k,v){window.__sizeWrites.push(k);return put.call(this,k,v);};
    },item);
    await context.route('**/frame-qa.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/widget-frame.css"><style>*{box-sizing:border-box}.card{height:${item.height}px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:20px}.box{height:40px}</style></head><body class="widget-page"><main class="widget-host" data-widget-host data-widget-key="widget-size-qa.html" ${item.shared?'data-widget-width-key="widget-width-qa"':''} ${item.mobile?'data-widget-mobile':''} data-widget-max-width="${item.base}" data-widget-height="${item.height}"><section class="card" data-widget-card><div class="box">기준</div><div class="box">폭</div><div class="box">복원</div><div class="box">검증</div><span data-widget-size-label></span><button data-widget-scale-handle></button></section></main><script src="/widget-frame.js"></script></body></html>`}));
    const tab=await context.newPage();
    await tab.goto('http://127.0.0.1:4173/frame-qa.html',{waitUntil:'networkidle'});
    const actual=await tab.evaluate(()=>({mode:document.body.dataset.widgetLayoutMode,width:document.querySelector('[data-widget-host]').getBoundingClientRect().width,height:document.querySelector('[data-widget-host]').getBoundingClientRect().height,logical:document.querySelector('[data-widget-card]').offsetWidth,writes:window.__sizeWrites}));
    results.push({name:item.name,pass:actual.mode===item.mode&&Math.abs(actual.width-item.visual)<1&&actual.writes.length===0,actual});
    if(item.name==='large phone dedicated'){
      await tab.setViewportSize({width:820,height:700});
      await tab.waitForFunction(()=>document.body.dataset.widgetLayoutMode==='scale');
      await tab.setViewportSize({width:390,height:700});
      await tab.waitForFunction(()=>document.body.dataset.widgetLayoutMode==='mobile');
      await tab.evaluate(()=>{window.__seed('widget-size-qa.html',{contentW:650,scale:1,frameH:600});window.dispatchEvent(new StorageEvent('storage',{key:'widget-size-qa.html'}));});
      await tab.waitForFunction(()=>document.body.dataset.widgetLayoutMode==='scale');
      results.push({name:'rotation and storage updates recompute mode without writing',pass:await tab.evaluate(()=>window.__sizeWrites.length===0&&JSON.parse(localStorage.getItem('widget-size-qa.html')).contentW===650)});
    }
    await context.close();
  }
  return {checked:results.length,failures:results.filter(r=>!r.pass),results};
}
