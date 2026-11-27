import Foundation
import CryptoKit

private func check(_ ok:Bool,_ detail:String) throws {if !ok {throw JournalError("FAIL "+detail)}}
private func key(_ seed:UInt8) -> String {
    Data(repeating:seed,count:32).base64EncodedString().replacingOccurrences(of:"=",with:"").replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_")
}
@main struct Verify {
    static func main() async throws {
        let args=CommandLine.arguments
        guard [3,4].contains(args.count),let endpoint=URL(string:args[1]),["127.0.0.1","localhost"].contains(endpoint.host ?? "") else {throw JournalError("Use an isolated local relay.")}
        let script=try String(contentsOfFile:args[2],encoding:.utf8), rules=try DeviceSyncRules(script:script)
        let space=UUID().uuidString,recovery=key(2),token=key(3),writer="adult-reader"
        let ctx:JournalObject=["space":space,"token":recovery],owner="p-child",me="p-adult",reader="child-reader"
        let keys:JournalObject=["key":key(4)]
        func network(_ path:String,method:String,body:Data?=nil,token:String=recovery) async throws {
            var req=URLRequest(url:endpoint.appending(path:"sync/"+space+path));req.httpMethod=method;req.httpBody=body;req.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
            let (_,response)=try await URLSession.shared.data(for:req)
            try check((response as? HTTPURLResponse)?.statusCode==204,method+" "+path)
        }
        try await network("",method:"PUT")
        let client=DeviceExchange(endpoint:endpoint)
        let child:JournalObject=["id":owner,"role":"Ребёнок","name":"Ребёнок QA"],adult:JournalObject=["id":me,"role":"Взрослый","name":"Взрослый QA"]
        func makePayload(role:String,member:String,device:String,token:String,people:[JournalObject]) async throws -> JournalObject {
            let grants=Dictionary(uniqueKeysWithValues:people.map{p in (p["id"] as! String,role=="child" ? "read" : p["id"] as? String==member ? "self":"edit")})
            let hash=SHA256.hash(data:Data(token.utf8)).map{String(format:"%02x",$0)}.joined()
            try await network("/devices/"+device,method:"PUT",body:jsonBytes(["tokenHash":hash,"grants":grants]))
            let family:JournalObject=["kind":"family","id":"qa","adminId":NSNull(),"members":people]
            let ids=Dictionary(uniqueKeysWithValues:people.map{($0["id"] as! String,keys)})
            let roster:JournalObject=["family":family,"profiles":ids,"tags":[],"templates":[],"city":"Минск"]
            let box=try AES.GCM.seal(jsonBytes(roster),using:decodeKey(key(5)),authenticating:client.aad(ctx,device,"roster"))
            _=try await client.send(ctx,["devices",device,"roster"],box.combined!,revision:0)
            var profiles=[String:JournalObject](),states=[String:JournalObject]()
            for id in ids.keys{
                let records=try jsonObject(try await client.read(ctx,keys,id,"records").0),consent=try jsonObject(try await client.read(ctx,keys,id,"consent").0)
                let a=records["value"] as! JournalObject,b=consent["value"] as! JournalObject
                profiles[id]=a.merging(b){_,new in new}
                states[id]=["key":key(4),"base":["records":["value":a,"rev":1],"consent":["value":b,"rev":1]],"stamps":JournalObject(),"uploaded":[],"choices":[]]
            }
            return ["version":2,"data":["schemaVersion":2,"family":family,"access":["role":role,"member":member,"deviceId":device,"revision":1],"profiles":profiles,"sync":["space":space,"token":token,"rosterKey":key(5),"profiles":states]],"files":[]]
        }
        let example:JournalObject=["files":[["id":"scan","visit":"v","name":"Снимок.txt","category":"Снимки","type":"text/plain"],["id":"cover","visit":"","name":"Заключение.txt","category":"Заключения","type":"text/plain"],["id":"other","visit":"else","name":"Другое.txt","type":"text/plain"]],
          "episodes":[["id":"ep","name":"Эпизод"]],
          "addedDoctors":[["id":"doc","values":["Лесов И.И.","Терапевт","Клиника QA"]]],
          "notes":[["id":"note","visit":"v","text":"Пометкасверки QA"]],
          "addedVisits":[["v","2026-01-01","Осмотр","doc","Эпизод","","scope","ep",[["id":"rx","name":"Курсограм QA","strength":"1 мг"]]]],
          "measurements":[["id":"temperature","name":"Термометрия QA","value":"36.5","unit":"°C","time":"2026-01-01T09:00"]],
          "exams":[["id":"exam","visit":"v","attachments":[["id":"cover"]]]],"fields":[["id":"weight","value":"60"]]]
        let consent:JournalObject=["auto":false,"directAuto":false]
        let envelope:(JournalObject,[JournalObject])->JournalObject={v,c in ["value":v,"conflicts":c,"author":"Администратор QA","time":"2026-01-02T00:00:00Z","stamps":JournalObject()]}
        for id in [owner,me] {
            var profile=example
            if id==me {profile["notes"]=[["id":"note","visit":"v","text":"Скрытыймаркер QA"]]}
            _=try await client.put(jsonBytes(envelope(profile,[])),ctx,keys,id,"records",0)
            _=try await client.put(jsonBytes(envelope(consent,[])),ctx,keys,id,"consent",0)
        }
        var adultPayload=try await makePayload(role:"adult",member:me,device:writer,token:token,people:[adult,child])
        let childPayload=try await makePayload(role:"child",member:owner,device:reader,token:key(8),people:[child])
        let names=Set(DeviceSyncRules.scopedFiles(profile:example,episode:"ep").compactMap{$0["id"] as? String})
        try check(names==["scan","cover"],"episode includes visit and exam originals only")
        var legacyEpisode=example;legacyEpisode["episodes"]=[];legacyEpisode["addedVisits"]=[["v","2026-01-01","Осмотр","doc","Эпизод",""]]
        try check(Set(DeviceSyncRules.scopedFiles(profile:legacyEpisode,episode:"visit:v").compactMap{$0["id"] as? String})==names,"legacy visit episode retains originals")
        let source=Data("Снимок QA для просмотра офлайн".utf8)
        try await client.publishOriginal(source,type:"text/plain",ctx:ctx,keys:keys,owner:owner,id:"scan")
        try await client.publishOriginal(Data("Сверенное заключение QA".utf8),type:"text/plain",ctx:ctx,keys:keys,owner:owner,id:"cover")
        let childCtx=((childPayload["data"] as! JournalObject)["sync"] as! JournalObject)
        let pinned=try await client.original(childCtx,keys,owner,"scan")
        var local=example,remote=example
        local["fields"]=[["id":"weight","value":"61"]];remote["fields"]=[["id":"weight","value":"62"]]
        var d=adultPayload["data"] as! JournalObject,p=d["profiles"] as! [String:JournalObject],c=d["sync"] as! JournalObject,states=c["profiles"] as! [String:JournalObject]
        p[owner]!.merge(local){_,new in new};d["profiles"]=p
        states[owner]!["stamps"]=["records":try rules.marked(before:example,after:local,original:[:],author:"Автор офлайн",time:"2026-01-01T11:00:00Z")]
        c["profiles"]=states;d["sync"]=c;adultPayload["data"]=d
        _=try await client.put(jsonBytes(envelope(remote,[])),ctx,keys,owner,"records",1)
        func sync(_ payload:JournalObject) async throws -> JournalObject {try await DeviceExchange(endpoint:endpoint).sync(payload,mergeScript:script)}
        let conflicted=try await sync(adultPayload)
        if args.count==4 {
            let destination=URL(fileURLWithPath:args[3])
            try jsonBytes(conflicted).write(to:destination,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:destination.path)
            print("Created synthetic local QA fixture");return
        }
        let pair=try jsonObject(try await client.read(ctx,keys,owner,"records").0)
        let held=pair["conflicts"] as! [JournalObject];try check(held.count==1,"one conflict")
        let conflict=held[0], alt=conflict["local"] as! JournalObject
        try check(alt["value"] as? String=="61" && alt["author"] as? String=="Автор офлайн" && alt["time"] as? String=="2026-01-01T11:00:00Z","local alternative + author + edit time")
        func withChoice(_ payload:JournalObject,side:String) -> JournalObject {
            var next=payload, data=payload["data"] as! JournalObject, ctx=data["sync"] as! JournalObject, states=ctx["profiles"] as! [String:JournalObject]
            states[owner]!["choices"]=[["id":conflict["id"]!,"lane":"records","side":side]];ctx["profiles"]=states;data["sync"]=ctx;next["data"]=data;return next
        }
        let denied=try await sync(withChoice(childPayload,side:"local")), afterChild=try jsonObject(try await client.read(ctx,keys,owner,"records").0)
        try check((afterChild["conflicts"] as? [JournalObject])?.count==1 && denied["data"] != nil,"child cannot resolve server conflict")
        let resolved=try await sync(withChoice(conflicted,side:"local")), published=try jsonObject(try await client.read(ctx,keys,owner,"records").0)
        let value=published["value"] as! JournalObject
        try check((published["conflicts"] as? [JournalObject])?.isEmpty==true && (value["fields"] as? [JournalObject])?.first?["value"] as? String=="61","reader receives writer decision")
        let adultData=resolved["data"] as! JournalObject, adultState=((adultData["sync"] as! JournalObject)["profiles"] as! [String:JournalObject])[owner]!
        try check((adultState["choices"] as? [JournalObject])?.isEmpty==true,"queue acknowledged")
        let stale=try rules.reconcile(base:value,local:value,remote:envelope(["fields":[["id":"weight","value":"63"]]],held),choices:[["id":conflict["id"]!,"side":"local"]],saved:[],actor:"QA",time:"2026-05-01",marks:[:])
        try check((stale["conflicts"] as? [JournalObject])?.count==1 && ((stale["value"] as? JournalObject)?["fields"] as? [JournalObject])?.first?["value"] as? String=="63","stale decision preserves newer edit")
        try check(!DeviceSyncRules.permits(role:"adult",member:me,owner:owner,lane:"consent") && DeviceSyncRules.permits(role:"adult",member:me,owner:me,lane:"consent"),"consent permissions")
        _=try rules.choose(profile:remote,conflict:conflict,side:"local")
        func profile(_ payload:JournalObject,_ id:String) -> JournalObject {
            (((payload["data"] as? JournalObject)?["profiles"] as? [String:JournalObject])?[id]) ?? [:]
        }
        var approved=consent;approved["chatGPTAuto"]=true
        for id in [owner,me] {
            _=try await client.put(jsonBytes(envelope(approved,[])),ctx,keys,id,"consent",1)
        }
        let received=try await sync(resolved)
        try check(DeviceExchange.consent(profile(received,owner))["chatGPTAuto"]==true,"native receives child consent")
        try check(!DeviceExchange.records(profile(received,owner)).keys.contains("chatGPTAuto"),"consent is outside records")
        var edited=received
        var editedData=edited["data"] as! JournalObject, editedProfiles=editedData["profiles"] as! [String:JournalObject]
        editedProfiles[me]!["directAuto"]=true
        editedData["profiles"]=editedProfiles;edited["data"]=editedData
        let changed=try await sync(edited)
        let selfConsent=DeviceExchange.consent(profile(changed,me))
        try check(selfConsent["directAuto"]==true && selfConsent["chatGPTAuto"]==true,"changing OpenRouter keeps the separate ChatGPT consent")
        let (latestRecords,latestRev)=try await client.read(ctx,keys,owner,"records")
        var legacy=try jsonObject(latestRecords)
        var legacyValue=legacy["value"] as! JournalObject
        legacyValue["chatGPTAuto"]=true;legacy["value"]=legacyValue
        _=try await client.put(jsonBytes(legacy),ctx,keys,owner,"records",latestRev)
        _=try await client.put(jsonBytes(envelope(consent,[])),ctx,keys,owner,"consent",2)
        let revokedConsent=try await sync(changed)
        try check(DeviceExchange.consent(profile(revokedConsent,owner))["chatGPTAuto"]==nil,"revoked native consent stays off even if records contain a legacy flag")
        guard let saved=DeviceReconnection(journal:childPayload) else {throw JournalError("Missing reconnect credentials")}
        let restoredKey=try JSONDecoder().decode(DeviceReconnection.self,from:JSONEncoder().encode(saved))
        let restored=try await sync(restoredKey.emptyJournal)
        try check(!profile(restored,owner).isEmpty && profile(restored,me).isEmpty,"fresh child installation gets current permitted chart only")
        try check((restored["files"] as? [JournalObject])?.isEmpty==true,"originals stay lazy after reconnect")
        let restoredContext=(restored["data"] as? JournalObject)?["sync"] as! JournalObject
        let restoredOriginal=try await client.original(restoredContext,keys,owner,"scan")
        try check(Data(base64Encoded:restoredOriginal["bytes"] as? String ?? "")==source,"fresh installation can fetch original")
        try await network("/devices/"+reader,method:"DELETE")
        do{_=try await sync(restoredKey.emptyJournal);throw JournalError("revoked device reconnected")}catch let e as ExchangeError {try check(e.status==403,"revoked saved connection")}
        try await client.publishOriginal(Data("Future file".utf8),type:"text/plain",ctx:ctx,keys:keys,owner:owner,id:"future")
        do{_=try await sync(childPayload);throw JournalError("revoked metadata leaked")}catch let e as ExchangeError {try check(e.status==403,"revoked roster")}
        do{_=try await client.original(childCtx,keys,owner,"future");throw JournalError("revoked original leaked")}catch let e as ExchangeError {try check(e.status==403,"revoked original")}
        try check(Data(base64Encoded:pinned["bytes"] as? String ?? "")==source,"downloaded offline original preserved")
        client.session.finishTasksAndInvalidate()
        print("PASS offline edit attribution; two alternatives; read-only child, provider-specific consent and revocation; adult resolution and stale decision; episode originals; revoked roster and future attachment denied")
    }
}
