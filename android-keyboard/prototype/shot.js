const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
await p.goto('file://'+process.cwd()+'/proto.html');await p.waitForTimeout(400);
for(const id of ['p1','p2','p3','p4','p5','p6']) await (await p.$('#'+id)).screenshot({path:id+'.png'});
await p.setViewportSize({width:1340,height:1000});await p.screenshot({path:'planche.png',fullPage:true});await b.close()})();
