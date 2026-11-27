import Foundation
import JavaScriptCore

/// An edit's path, alternatives and recorded decision use the same JSON representation as the web journal.
struct DeviceSyncRules {
    let js:JSContext
    init(script:String) throws {
        guard let ctx=JSContext() else {throw JournalError("Не удалось подготовить обмен.")}
        js=ctx
        ctx.evaluateScript("if (typeof structuredClone !== 'function') globalThis.structuredClone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));")
        ctx.evaluateScript(script)
        if ctx.exception != nil {throw JournalError("Не удалось загрузить правила объединения правок.")}
    }
    init() throws {
        guard let url=Bundle.main.url(forResource:"sync-merge",withExtension:"js") else {throw JournalError("Правила обмена недоступны.")}
        try self.init(script:String(contentsOf:url,encoding:.utf8))
    }
    private func call(_ body:String,args:[Any]) throws -> JSValue {
        js.exception=nil
        // A stable JSON property order is significant for syncMerge.same and its path stamps.
        let encoded=try jsonBytes(args)
        guard let result=js.evaluateScript("(function(input){const a=JSON.parse(input);return ("+body+")(...a)})")?.call(withArguments:[String(decoding:encoded,as:UTF8.self)]),
              js.exception==nil,!result.isUndefined else {throw JournalError("Данные для выбора изменились. Обновите профиль.")}
        return result
    }
    func marked(before:JournalObject,after:JournalObject,original:JournalObject,author:String,time:String) throws -> JournalObject {
        try call("""
        (a,b,marks,author,time)=>{for(const path of syncMerge.changes(a,b))marks[path]={author,time};return marks}
        """,args:[before,after,original,author,time]).toDictionary() as? JournalObject ?? original
    }
    func choose(profile:JournalObject,conflict:JournalObject,side:String) throws -> JournalObject {
        guard ["local","remote"].contains(side) else {throw JournalError("Выберите один из вариантов.")}
        let value=try call("""
        (p,c,side)=>{
          const current=syncMerge.read(p,c.path);
          if(!syncMerge.same(current,c.local.value)&&!syncMerge.same(current,c.remote.value))throw Error('stale');
          return syncMerge.choose(p,c.path,c[side]);
        }
        """,args:[profile,conflict,side])
        guard let changed=value.toDictionary() as? JournalObject else {throw JournalError("Не удалось сохранить выбранное значение.")}
        return changed
    }
    func reconcile(base:JournalObject,local:JournalObject,remote:JournalObject,choices:[JournalObject],saved:[JournalObject],
                   actor:String,time:String,marks:JournalObject) throws -> JournalObject {
        let result=try call("""
        (base,local,remote,choices,saved,author,time,ownMarks,uuid)=>{
          const m=syncMerge.merge(base,local,remote.value,{local:{author,time,stamps:ownMarks},remote});
          const prior=[...new Map([...(remote.conflicts||[]),...saved].map(c=>[c.id,c])).values()];
          const remaining=prior.filter(c=>!choices.some(choice=>choice.id===c.id));
          for(const choice of choices){
            const c=prior.find(x=>x.id===choice.id);
            if(!c||!['local','remote'].includes(choice.side))continue;
            const current=syncMerge.read(m.value,c.path);
            if(syncMerge.same(current,c.local.value)||syncMerge.same(current,c.remote.value)){
              m.value=syncMerge.choose(m.value,c.path,c[choice.side]);
            }else{
              const live=current===undefined?{removed:true}:{value:current};
              m.conflicts.push({path:c.path,local:c[choice.side],remote:{...live,author:remote.author,time:remote.time}});
            }
          }
          for(const c of m.conflicts){
            if(!remaining.some(x=>syncMerge.same(x.path,c.path)&&syncMerge.same(x.local,c.local)&&syncMerge.same(x.remote,c.remote)))remaining.push({...c,id:uuid+'-'+remaining.length});
          }
          const stamps={...(remote.stamps||{})};
          for(const p of syncMerge.changes(remote.value,m.value))stamps[p]=ownMarks[p]||{author,time};
          return {value:m.value,conflicts:remaining,author,time,stamps};
        }
        """,args:[base,local,remote,choices,saved,actor,time,marks,UUID().uuidString])
        guard let value=result.toDictionary() as? JournalObject else {throw JournalError("Не удалось объединить изменения.")}
        return value
    }

    static func permits(role:String,member:String,owner:String,lane:String,admin:Bool=false,child:Bool=false) -> Bool {
        ["records","consent"].contains(lane) && (admin || role=="admin" && (lane=="records" || owner==member || child) || role=="adult" && (lane=="records" || owner==member))
    }
    static func scopedFiles(profile:JournalObject,episode:String) -> [JournalObject] {
        let groups=profile["episodes"] as? [JournalObject] ?? []
        let visits=Set((profile["addedVisits"] as? [[Any]] ?? []).filter{row in
            if row.count>7, let id=row[7] as? String,!id.isEmpty {return id==episode}
            guard row.count>4,let label=row[4] as? String else {return false}
            let matches=groups.filter{$0["name"] as? String==label}
            if matches.count==1 {return matches[0]["id"] as? String==episode}
            return (row[0] as? String).map{"visit:"+$0==episode} ?? false
        }.compactMap{$0.first as? String})
        let exams=profile["exams"] as? [JournalObject] ?? []
        let attached=Set(exams.filter{visits.contains($0["visit"] as? String ?? "") || $0["episode"] as? String==episode}.flatMap{($0["attachments"] as? [JournalObject] ?? []).compactMap{$0["id"] as? String}})
        return (profile["files"] as? [JournalObject] ?? []).filter{f in
            visits.contains(f["visit"] as? String ?? "") || f["episode"] as? String==episode || attached.contains(f["id"] as? String ?? "")
        }
    }
}
