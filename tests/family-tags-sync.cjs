const {chromium}=require('playwright-core');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto'),{execFileSync}=require('node:child_process');

(async()=>{
  const endpoint=process.env.HEALTH_PREVIEW_URL;
  const native=process.env.HS_SWIFT_TAG_CLIENT;
  if(!endpoint||new URL(endpoint).hostname!=='127.0.0.1'||!native)throw Error('Use the isolated local relay and compiled Swift verifier.');
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'hs-tags-roundtrip-'));
  const browser=await chromium.launch({channel:'chrome'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),p=await context.newPage();
    await p.route('https://**',r=>r.abort());
    await p.goto(endpoint+'?new=family');
    await p.locator('[name=familyName]').fill('Проверка тегов');
    await p.locator('[name=memberName]').fill('Администратор QA');
    await p.locator('#family-form button').click();
    await p.getByRole('heading',{name:'Администратор QA',exact:true}).waitFor();
    await p.evaluate(()=>{
      for(const member of [{id:'p-qa-adult',name:'Взрослый QA',role:'Взрослый'},{id:'p-qa-child',name:'Ребёнок QA',role:'Ребёнок'}]){
        family.members.push(member);prototypeState.profiles[member.id]=makeState(personFromMember(member));
      }
      if(!saveState())throw Error('Could not seed the family.');
      return deviceSync.enable();
    });
    await p.goto(endpoint+'?section=settings');
    await p.locator('main [data-action=tagLibrary]').click();
    await p.getByRole('button',{name:'Создать тег'}).click();
    await p.locator('#tag-definition [name=title]').fill('Справочник из веба');
    await p.locator('#tag-definition [name=keywords]').fill('Анализ QA');
    await p.getByRole('button',{name:'Сохранить тег',exact:true}).click();
    await p.getByRole('button',{name:/Справочник из веба/}).waitFor();
    const packets=[];
    for(const member of ['admin','p-qa-adult','p-qa-child']){
      const packet=await p.evaluate(async ({member,device})=>{
        const data=readJson(familyStateKey),scoped=projectForDevice(data,member==='admin'?data.family.adminId:member,device,1);
        scoped.sync=await deviceSync.grant(scoped,device);
        return {version:2,data:scoped,files:[]};
      },{member,device:randomBytes(32).toString('hex')});
      assert.equal(Object.hasOwn(packet.data.profiles,'_health_story_family_tags_v1'),false);
      assert.equal(Object.hasOwn(packet.data.sync.profiles,'_health_story_family_tags_v1'),false);
      const file=path.join(tmp,member+'.json');await fs.writeFile(file,JSON.stringify(packet),{mode:0o600});packets.push(file);
    }
    console.log(execFileSync(native,[endpoint,path.join(__dirname,'../assets/app/sync-merge.js'),...packets],{encoding:'utf8'}).trim());
    await p.goto(endpoint+'?section=settings');
    await p.getByRole('heading',{name:'Администратор QA',exact:true}).waitFor();
    await p.evaluate(()=>deviceSync.synchronize());
    await p.locator('main [data-action=tagLibrary]').click();
    await p.getByRole('button',{name:/Тег с iPhone/}).click();
    await p.locator('#tag-definition [name=title]').fill('Переименован на вебе');
    await p.getByRole('button',{name:'Сохранить тег',exact:true}).click();
    await p.getByRole('button',{name:/Переименован на вебе/}).waitFor();
    const row=await p.evaluate(()=>prototypeState.tags.find(t=>t.id==='ios-corpus'));
    assert.deepEqual(row,{id:'ios-corpus',name:'Переименован на вебе',keywords:['Проверка QA','Тег с iPhone']});
    console.log('PASS native tag visible in browser, browser rename retained the former name for inference');
  }finally{
    await browser.close();
    await fs.rm(tmp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
