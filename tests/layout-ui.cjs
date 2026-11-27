const assert=require('node:assert/strict');
const {resolve}=require('node:path');
const {chromium,webkit,devices}=require('playwright-core');

const base=process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/';
const screens=process.env.HEALTH_LAYOUT_SCREENSHOTS;
const widths=[1440,768,560,390,320];
const sections=['overview','visits','labs','exams','files','consults','settings'];
const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)
  && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
const matrix=process.argv.includes('--iphone')?widths.filter(w=>w<=390):widths.filter(w=>w>390);

async function goto(p,query){
  await p.goto(new URL(query,base).href,{waitUntil:'domcontentloaded'});
  await p.locator('main h1').waitFor();
}

async function checkSurface(p,label){
  const findings=await p.evaluate(()=>{
    const problems=[];
    const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1
      && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    const visible=el=>el.getClientRects().length>0 && getComputedStyle(el).visibility==='visible';
    for(const el of document.querySelectorAll('html,.bar,main,.workspace-tools,dialog[open],dialog[open] .fields-side')){
      if(visible(el) && el.scrollWidth>el.clientWidth+1)problems.push('horizontal overflow in '+(el.id||el.className||el.tagName));
    }
    for(const pair of document.querySelectorAll('.intake-pair,.exam-reading')){
      const fields=[...pair.querySelectorAll(':scope > label > :is(input:not([type=checkbox]),select)')].filter(visible);
      if(fields.length!==2)continue;
      const [a,b]=fields.map(el=>el.getBoundingClientRect());
      if(a.right<=b.left+1&&Math.abs(a.top-b.top)>1){
        problems.push('misaligned fields: '+fields.map(el=>el.name).join(' / '));
      }
      if(Math.abs(a.height-b.height)>1){
        problems.push('different field heights: '+fields.map(el=>el.name).join(' / '));
      }
    }
    for(const group of document.querySelectorAll('.bar-actions,.actions,.section-nav,.visit-links,.visit-modes,.source-tabs,.category-filters')){
      const controls=[...group.children].filter(el=>el.matches('button,a')&&visible(el));
      for(const [i,a] of controls.entries()){
        const first=a.getBoundingClientRect(),style=getComputedStyle(a);
        if(a.classList.contains('button') && (parseFloat(style.paddingLeft)<12||parseFloat(style.paddingRight)<12)){
          problems.push('insufficient button padding: '+a.textContent.trim());
        }
        for(const b of controls.slice(i+1)){
          const second=b.getBoundingClientRect();
          if(intersects(first,second))problems.push('overlapping controls: '+a.textContent.trim()+' / '+b.textContent.trim());
          const vertical=Math.min(first.bottom,second.bottom)>Math.max(first.top,second.top);
          if(group.matches('.actions')){
            const horizontal=Math.min(first.right,second.right)>Math.max(first.left,second.left);
            const gap=vertical?Math.max(second.left-first.right,first.left-second.right):
              horizontal?Math.max(second.top-first.bottom,first.top-second.bottom):Infinity;
            if(gap<8)problems.push('crowded adjacent buttons: '+a.textContent.trim()+' / '+b.textContent.trim());
          }
        }
      }
    }
    return problems;
  });
  assert.deepEqual(findings,[],label);
}

async function checkProfileHeader(p,width){
  await goto(p,'?section=overview');
  await p.evaluate(()=>document.fonts.ready);
  const positions=()=>p.evaluate(()=>{
    const navigation=[...document.querySelectorAll('.hero,.hero-btn,.workspace-tools,.section-nav button,.global-search,.workspace-content')].map(el=>{
      const {left,top,width,height}=el.getBoundingClientRect();
      return [left,top+window.scrollY,width,el.matches('.workspace-content')?null:height];
    });
    const {left,top}=document.querySelector('.workspace-content h2').getBoundingClientRect();
    return {navigation,sectionHeading:[left,top+window.scrollY]};
  });
  async function checkTabs(tabs){
    const overview=await positions();
    for(const tab of tabs){
      const scope=tab==='settings'?'header':'.section-nav';
      await p.locator(scope+' [data-action=section][data-id='+tab+']').click();
      assert.deepEqual(await positions(),overview,width+' px: navigation or section heading shifted on '+tab);
      const active=await p.locator('.section-nav [aria-current=page]').evaluateAll(tabs=>tabs.map(el=>el.dataset.id));
      assert.deepEqual(active,tab==='settings'?[]:[tab]);
    }
  }
  await checkTabs([...sections.slice(1),'overview']);
  await p.evaluate(()=>{person.name='Константинова Александра-Маргарита Александровна';render()});
  await checkTabs(['visits','overview']);
  const geometry=await p.evaluate(()=>{
    const title=document.querySelector('.hero h1'),range=document.createRange();
    range.selectNodeContents(title);
    const box=el=>document.querySelector(el).getBoundingClientRect().toJSON();
    return {lines:[...range.getClientRects()].map(r=>r.toJSON()),medical:box('.hero-btn'),search:box('.global-search')};
  });
  for(const line of geometry.lines){
    assert(!overlap(line,geometry.medical)&&!overlap(line,geometry.search),width+' px: profile name overlaps a button');
  }
  await checkSurface(p,width+' px: long profile title');
  await p.locator('.section-nav [data-id=visits]').press('Enter');
  assert.equal(await p.locator('.section-nav [aria-current="page"]:focus').count(),1,width+' px: keyboard navigation lost focus');
}

async function checkLab(p,width){
  await goto(p,'?section=labs');
  await p.locator('main [data-action=upload]').click();
  await p.locator('#upload-form [name=file]').setInputFiles(resolve(__dirname,'../assets/documents/cbc.pdf'));
  await p.locator('#upload-form button.primary').click();
  await p.locator('#lab-form').waitFor({timeout:90000});
  const group=p.locator('.lab-input .intake-pair').first();
  await group.locator('[name=reading]').fill('18.74');
  await group.locator('[name=unit]').fill('нг/мл');
  const [reading,unit]=await Promise.all([group.locator('[name=reading]').boundingBox(),group.locator('[name=unit]').boundingBox()]);
  assert(reading&&unit);
  assert.equal(reading.height,unit.height,width+' px: inputs have different heights');
  assert(reading.height>=44,width+' px: reading control under 44 px');
  if(width>540){
    assert(Math.abs(reading.y-unit.y)<1,width+' px: inputs begin at different heights');
    assert(unit.x-reading.x-reading.width>=12,width+' px: paired inputs are crowded');
  }else{
    assert(unit.y-reading.y-reading.height>=12,width+' px: stacked inputs are crowded');
    assert(Math.abs(reading.width-unit.width)<1,width+' px: stacked inputs have different widths');
  }
  await checkSurface(p,width+' px: laboratory reviewer');
  if(screens&&(width===1440||width===390)){
    await group.locator('[name=unit]').blur();
    await group.screenshot({path:resolve(screens,'lab-fields-'+width+'.png')});
  }
  await p.getByRole('button',{name:'Закрыть',exact:true}).click();
}

async function checkVisitJumps(p,width){
  await goto(p,'?visit=a1');
  const dialog=p.locator('dialog');
  await dialog.getByRole('button',{name:/Пометки ·/}).click();
  const boxes=await p.evaluate(()=>{
    const rect=sel=>document.querySelector(sel).getBoundingClientRect().toJSON();
    return {header:rect('.dialog-heading'),section:rect('#visit-notes h3')};
  });
  assert(!overlap(boxes.header,boxes.section),width+' px: sticky dialog header covers the section heading');
  await checkSurface(p,width+' px: visit detail');
  const note=dialog.getByRole('button',{name:'Добавить пометку',exact:true});
  await note.scrollIntoViewIfNeeded();
  const scroll=()=>dialog.evaluate(el=>el.scrollTop);
  const before=await scroll();assert(before>0);
  await note.click();
  await dialog.locator('[data-action=back]').click();
  assert(Math.abs(await scroll()-before)<=1,width+' px: visit lost its scroll position');
  assert(await note.evaluate(el=>el===document.activeElement),width+' px: visit lost its opener focus');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
}

async function checkFieldValidation(p,width){
  await goto(p,'?new=visit');
  const visit=p.locator('#visit-form');
  const field=(form,name)=>form.locator('[name="'+name+'"]');
  const issue=(form,name)=>form.locator('[name="'+name+'"] + .field-issue');
  await visit.getByRole('button',{name:'Сохранить визит',exact:true}).click();
  for(const name of ['episodeName','title','doctorName']){
    await issue(visit,name).waitFor();
    assert.equal(await field(visit,name).getAttribute('aria-invalid'),'true');
    assert.equal(await field(visit,name).getAttribute('aria-describedby'),await issue(visit,name).getAttribute('id'));
  }
  await p.waitForFunction(()=>document.activeElement.name==='episodeName');
  assert(await field(visit,'episodeName').evaluate(el=>el.closest('label').getBoundingClientRect().top>=
    document.querySelector('.dialog-heading').getBoundingClientRect().bottom-1),width+' px: field label is covered by the dialog title');
  await field(visit,'episodeName').fill('   ');
  await field(visit,'title').fill('Проверка полей');
  await issue(visit,'title').waitFor({state:'detached'});
  assert.equal(await field(visit,'title').getAttribute('aria-invalid'),null);
  assert(await issue(visit,'episodeName').isVisible());
  assert(await issue(visit,'doctorName').isVisible());
  await field(visit,'doctor').selectOption({index:1});
  await issue(visit,'doctorName').waitFor({state:'detached'});
  await field(visit,'episodeName').fill('Учебный эпизод');
  await issue(visit,'episodeName').waitFor({state:'detached'});
  await p.locator('dialog [data-action=close]').click();

  await goto(p,'?new=exam');
  const exam=p.locator('#exam-form');
  await exam.getByRole('button',{name:'Сохранить обследование',exact:true}).click();
  await issue(exam,'method').waitFor();await issue(exam,'description').waitFor();
  await field(exam,'method').selectOption('УЗИ');
  await issue(exam,'method').waitFor({state:'detached'});
  await exam.getByRole('button',{name:'Добавить параметр',exact:true}).click();
  await issue(exam,'description').waitFor({state:'detached'});
  await exam.getByRole('button',{name:'Сохранить обследование',exact:true}).click();
  await issue(exam,'paramName').waitFor();await issue(exam,'paramValue').waitFor();
  await field(exam,'paramName').fill('Толщина');await issue(exam,'paramName').waitFor({state:'detached'});
  assert(await issue(exam,'paramValue').isVisible());
  await checkSurface(p,width+' px: exam validation');
  await field(exam,'paramValue').fill('14');await issue(exam,'paramValue').waitFor({state:'detached'});
  await p.locator('dialog [data-action=close]').click();
}

async function checkSearchNavigation(p,width){
  await goto(p,'?section=overview');
  await p.locator('.global-search').click();
  const search=p.locator('#global-search'),hits=p.locator('#hits');
  const kind=await p.locator('#search-kind').boundingBox();
  const before=await search.boundingBox();
  const searchBox=await p.locator('.search-tools .searchbox').boundingBox();
  assert.equal(kind.height,searchBox.height);
  assert(kind.height>=44);
  await search.fill('нет совпадений 0123456789');
  await hits.getByText(/Совпадений нет/).waitFor();
  assert.deepEqual(await search.boundingBox(),before,width+' px: search input shifted on empty results');
  await search.clear();
  assert.deepEqual(await search.boundingBox(),before);
  const result=hits.locator('.result-row').last();
  await result.scrollIntoViewIfNeeded();
  const scroll=()=>hits.evaluate(el=>el.scrollTop);
  const offset=await scroll();assert(offset>0);
  await result.click();
  await p.locator('dialog [data-action=back]').click();
  assert(Math.abs(await scroll()-offset)<=1,width+' px: search lost its scroll position');
  assert(await result.evaluate(el=>el===document.activeElement),width+' px: search lost its result focus');
  await checkSurface(p,width+' px: global search');
  await p.locator('dialog [data-action=close]').click();
}

async function checkWorkspaceNavigation(p,width){
  await goto(p,'?section=overview');
  const tab=id=>p.locator('.section-nav [data-id='+id+']');
  const active=()=>p.locator('.section-nav [aria-current=page]').getAttribute('data-id');
  const filter=async(action,id)=>{
    const control=p.locator('[data-action='+action+'][data-id="'+id+'"]');
    await control.press('Enter');
    assert.equal(await control.getAttribute('aria-pressed'),'true');
    assert(await control.evaluate(el=>el===document.activeElement),width+' px: filter lost focus');
  };
  await tab('visits').click();
  if(width===320){
    const nav=await p.locator('.section-nav').boundingBox();
    const visit=await p.locator('#listing .visit-row').first().boundingBox();
    assert(nav.height<=144&&visit.y<650,width+' px: navigation hides the first visit');
  }
  await filter('historyMode','episodes');
  await tab('labs').click();
  const search=()=>p.locator('#section-filter').evaluate(el=>el.getBoundingClientRect().top+scrollY);
  const before=await search();
  await filter('labFilter','Биохимия');
  await filter('analysisMode','indicators');
  assert.equal(await search(),before,width+' px: lab search shifted');
  await filter('analysisMode','prevention');
  assert.equal(await search(),before,width+' px: prevention search shifted');
  await p.goBack();assert.equal(await active(),'visits');
  await p.goBack();assert.equal(await active(),'overview');
  await p.goForward();assert.equal(await active(),'visits');
  await p.goForward();assert.equal(await active(),'labs');
  await tab('files').click();await filter('docFilter','Снимки');
  await tab('exams').click();
  const opener=p.locator('main [data-action=newExam]');
  await opener.press('Enter');
  const dialog=p.locator('dialog');await dialog.waitFor();
  await dialog.locator('#panel-title').press('Escape');
  await dialog.waitFor({state:'hidden'});
  await p.waitForFunction(()=>document.activeElement.matches('main [data-action=newExam]'));
}

async function checkRecordManager(p,width){
  await goto(p,'?section=settings');
  await p.locator('main [data-action=manageRecords]').click();
  const dialog=p.locator('dialog');
  const search=dialog.getByLabel('Поиск записи',{exact:true});
  const category=dialog.getByLabel('Тип записи',{exact:true});
  const row=dialog.locator('.record-row').first();
  const remove=row.getByRole('button',{name:'Удалить',exact:true});
  const [searchBox,categoryBox,listBox,removeBox]=await Promise.all([
    search.boundingBox(),category.boundingBox(),dialog.locator('.record-list').boundingBox(),remove.boundingBox()
  ]);
  const label=width+' px: record manager';
  assert(searchBox&&categoryBox&&listBox&&removeBox,label+' has missing controls');
  assert(searchBox.height>=44&&Math.abs(searchBox.height-categoryBox.height)<1,label+' has mismatched filter heights');
  assert(listBox.y-Math.max(searchBox.y+searchBox.height,categoryBox.y+categoryBox.height)>=12,label+' has crowded filters and list');
  if(width>540){
    assert(Math.abs(searchBox.y-categoryBox.y)<1,label+' has misaligned filters');
    assert(categoryBox.x-searchBox.x-searchBox.width>=12,label+' has crowded filters');
  }else{
    assert(categoryBox.y-searchBox.y-searchBox.height>=12,label+' has crowded stacked filters');
    assert(Math.abs(searchBox.width-categoryBox.width)<1,label+' has mismatched filter widths');
  }
  const padding=await remove.evaluate(button=>Number.parseFloat(getComputedStyle(button).paddingInlineStart));
  assert(removeBox.height>=44&&padding>=12,label+' has a cramped delete button');
  if(screens&&(width===1440||width===390))await dialog.screenshot({path:resolve(screens,'record-manager-'+width+'.png'),scale:'css'});
  await row.locator('.record-info span').evaluate(title=>{title.textContent='Очень_длинное_название_медицинского_документа_'.repeat(5)+'.pdf'});
  const [textBox,buttonBox]=await Promise.all([row.locator('.record-info').boundingBox(),remove.boundingBox()]);
  assert(buttonBox.x-textBox.x-textBox.width>=12,label+' has overlapping row text and button');
  await checkSurface(p,label);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
}

async function checkArchive(p,width){
  await goto(p,'?section=settings');
  await p.locator('main [data-action=archive]').click();
  const panel=p.locator('.archive-panel');
  const [backups,utilities]=await Promise.all([
    panel.locator('.archive-backup .actions').boundingBox(),panel.locator('.archive-utilities .actions').boundingBox()
  ]);
  assert(backups&&utilities&&utilities.y-backups.y-backups.height>=12,width+' px: crowded archive actions');
  await checkSurface(p,width+' px: archive');
}

async function checkPromptPicker(p,width){
  await goto(p,'?new=consultation');
  const picker=p.locator('.prompt-picker'),summary=picker.locator('summary');
  const options=picker.getByRole('group',{name:'Варианты промпта'});
  await summary.press('Enter');
  const [trigger,menu,question]=await Promise.all([
    summary.boundingBox(),options.boundingBox(),p.locator('#consult-form [name=question]').boundingBox()
  ]);
  assert(trigger&&menu&&question,width+' px: prompt picker did not open');
  assert.equal(menu.x,trigger.x,width+' px: prompt menu is offset');
  assert.equal(menu.width,trigger.width,width+' px: prompt menu has a different width');
  assert(menu.y>trigger.y+trigger.height&&menu.y+menu.height<question.y,width+' px: prompt menu overlaps form fields');
  await checkSurface(p,width+' px: prompt menu');
  await options.getByRole('button',{name:'Оценка факторов риска'}).press('Space');
  assert.equal(await p.locator('#consult-form [name=template]').inputValue(),'risk-factors');
  assert.equal(await p.locator('#template-details').isVisible(),true);
  assert.equal(await options.isVisible(),false);
  await summary.press('Enter');
  assert.equal(await options.getByRole('button',{name:'Оценка факторов риска'}).getAttribute('aria-pressed'),'true');
  await summary.press('Escape');
  assert.equal(await options.isVisible(),false);
  assert.equal(await p.locator('dialog').isVisible(),true);
}

(async()=>{
  const mobile=process.argv.includes('--iphone');
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    for(const width of matrix){
      const ctx=await browser.newContext({...mobile?devices['iPhone 13']:{},viewport:{width,height:850},serviceWorkers:'block'});
      const p=await ctx.newPage();
      try{
        for(const section of sections){
          await goto(p,'?section='+section);
          await checkSurface(p,width+' px: '+section);
        }
        await checkProfileHeader(p,width);
        await checkSearchNavigation(p,width);
        await checkWorkspaceNavigation(p,width);
        for(const query of ['?new=visit','?new=visit&mode=photo','?new=exam','?connect=chatgpt','?new=family']){
          await goto(p,query);
          await p.locator('dialog[open] #panel-title').waitFor();
          await checkSurface(p,width+' px: '+query);
        }
        await checkVisitJumps(p,width);
        await checkFieldValidation(p,width);
        await checkLab(p,width);
        await checkRecordManager(p,width);
        await checkArchive(p,width);
        await checkPromptPicker(p,width);
        console.log('PASS',mobile?'mobile WebKit':'Chrome',width+' px','section history, stable search, restored scroll and focus, forms and dialogs');
      }finally{await ctx.close()}
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
