import Foundation
import CryptoKit
import JavaScriptCore

struct ExchangeError: LocalizedError {
    let status: Int
    var errorDescription: String? {
        switch status {
        case 403: "Обмен запрещён. Проверьте доступ устройства у администратора."
        case 412: "Карта изменилась во время обмена. Повторите синхронизацию."
        case 413: "Часть вложения превышает лимит сервера. Обновите приложение."
        default: "Сервер обмена недоступен (код \(status))."
        }
    }
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

struct DeviceExchange {
    static let cloud = URL(string:"https://health-story-sync.xzx89s.workers.dev")!
    let endpoint: URL
    let session = URLSession(configuration:.ephemeral,delegate:NoRedirect(),delegateQueue:nil)
    init(endpoint: URL = cloud) { self.endpoint = endpoint }
    static func require(_ value: Any?) throws -> String {
        guard let s=value as? String, !s.isEmpty else {throw JournalError("Неполные данные обмена.")};return s
    }
    func send(_ ctx: JournalObject, _ path: [String], _ body: Data? = nil, revision: Int? = nil) async throws -> (Data,Int) {
        let space=try Self.require(ctx["space"]), token=try Self.require(ctx["token"])
        var url=endpoint.appendingPathComponent("sync")
        for part in [space]+path {
            guard part.range(of:"^[A-Za-z0-9_-]{1,128}$",options:.regularExpression) != nil else {throw JournalError("Некорректный адрес записи.")}
            url.appendPathComponent(part)
        }
        var req=URLRequest(url:url); req.timeoutInterval=25
        req.httpMethod=body == nil ? "GET":"PUT"; req.httpBody=body
        req.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
        if let revision {req.setValue("\"\(revision)\"",forHTTPHeaderField:"If-Match")}
        let (data,res)=try await session.data(for:req)
        guard let http=res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {throw ExchangeError(status:(res as? HTTPURLResponse)?.statusCode ?? 0)}
        guard let tag=http.value(forHTTPHeaderField:"ETag"),let rev=Int(tag.trimmingCharacters(in:CharacterSet(charactersIn:"\""))),rev>0 else {throw JournalError("Сервер не вернул номер версии.")}
        return (data,rev)
    }

    func aad(_ ctx: JournalObject,_ id: String,_ name: String) throws -> Data {
        Data(("HS-sync-1/"+(try Self.require(ctx["space"]))+"/"+id+"/"+name).utf8)
    }
    func opened(_ data: Data, keys: JournalObject, aad: Data) throws -> Data {
        let box=try AES.GCM.SealedBox(combined:data)
        for code in [try Self.require(keys["key"])] + (keys["previousKeys"] as? [String] ?? []) {
            if let clear=try? AES.GCM.open(box,using:decodeKey(code),authenticating:aad) {return clear}
        }
        throw JournalError("Не удалось проверить шифрование записи. Обновите доступ.")
    }
    func put(_ bytes: Data,_ ctx: JournalObject,_ keys: JournalObject,_ id: String,_ name: String,_ rev: Int) async throws -> Int {
        let key=try decodeKey(Self.require(keys["key"]))
        let box=try AES.GCM.seal(bytes,using:key,authenticating:aad(ctx,id,name))
        guard let combined=box.combined else {throw JournalError("Не удалось зашифровать запись.")}
        return try await send(ctx,["profiles",id,name],combined,revision:rev).1
    }
    func read(_ ctx: JournalObject,_ keys: JournalObject,_ id: String,_ name: String) async throws -> (Data,Int) {
        let (data,rev)=try await send(ctx,["profiles",id,name])
        return (try opened(data,keys:keys,aad:aad(ctx,id,name)),rev)
    }
    private static let objectLimit = 16*1024*1024, partSize = 4*1024*1024, fileLimit = 128*1024*1024
    private struct Manifest: Codable {
        let size:Int, mime:String, sha256:String, token:String
        func part(_ index:Int)->String {"blob-part-"+token+"-"+String(index)}
    }
    private enum Descriptor {case legacy(String,Data), parts(Manifest)}
    private static func digest(_ bytes:Data)->String {SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()}
    private func descriptor(_ bytes:Data) throws -> Descriptor {
        guard let end=bytes.firstIndex(of:10),end<=1024 else {throw JournalError("Некорректное вложение.")}
        let header=bytes.prefix(upTo:end),body=bytes.suffix(from:end+1)
        if header==Data("HSO2".utf8) {
            guard bytes.count<=4096,let m=try? JSONDecoder().decode(Manifest.self,from:body),
                  (1...Self.fileLimit).contains(m.size), m.mime.count<=512,
                  m.token.range(of:"^[A-Za-z0-9_-]{43}$",options:.regularExpression) != nil,
                  m.sha256.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil else {throw JournalError("Некорректный перечень частей вложения.")}
            return .parts(m)
        }
        guard let mime=try JSONSerialization.jsonObject(with:header,options:.fragmentsAllowed) as? String else {throw JournalError("Некорректный формат вложения.")}
        return .legacy(mime,body)
    }
    private func verifyPublished(_ bytes:Data, source:Data, type:String, digest:String) throws {
        let same:Bool
        switch try descriptor(bytes) {
        case .parts(let m):same=m.size==source.count && m.mime==type && m.sha256==digest
        case .legacy(let mime,let raw):same=mime==type && raw==source
        }
        if !same {throw JournalError("У оригинала с таким ID другое содержимое.")}
    }
    private func existing(_ ctx:JournalObject,_ keys:JournalObject,_ id:String,_ name:String) async throws -> Data? {
        do {return try await read(ctx,keys,id,name).0}
        catch let e as ExchangeError where e.status==404 {return nil}
    }
    func publishOriginal(_ source:Data,type:String,ctx:JournalObject,keys:JournalObject,owner:String,id:String) async throws {
        guard source.count<=Self.fileLimit else {throw JournalError("Обмен поддерживает оригиналы до 128 МиБ. Сохраните более крупный файл в отдельном зашифрованном архиве.")}
        let object="blob-"+id
        let header=try JSONEncoder.withoutSlashEscaping.encode(type)+Data([10])
        if source.count+header.count+28<=Self.objectLimit {
            do {_=try await put(header+source,ctx,keys,owner,object,0)}
            catch let e as ExchangeError where e.status==412 {
                try verifyPublished(try await read(ctx,keys,owner,object).0,source:source,type:type,digest:Self.digest(source))
            }
            return
        }
        let digest=Self.digest(source)
        if let published=try await existing(ctx,keys,owner,object) {
            try verifyPublished(published,source:source,type:type,digest:digest);return
        }
        let context="original-parts-1/"+owner+"/"+id+"/"+digest
        let key=SymmetricKey(data:Data(try Self.require(keys["key"]).utf8))
        let token=Data(HMAC<SHA256>.authenticationCode(for:Data(context.utf8),using:key)).base64EncodedString()
            .replacingOccurrences(of:"=",with:"").replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_")
        let m=Manifest(size:source.count,mime:type,sha256:digest,token:token)
        for offset in stride(from:0,to:source.count,by:Self.partSize) {
            let name=m.part(offset/Self.partSize),chunk=source.subdata(in:offset..<min(source.count,offset+Self.partSize))
            var found=try await existing(ctx,keys,owner,name)
            if found==nil {
                do {_=try await put(chunk,ctx,keys,owner,name,0);continue}
                catch let e as ExchangeError where e.status==412 {found=try await read(ctx,keys,owner,name).0}
            }
            guard found==chunk else {throw JournalError("У переданной части другое содержимое.")}
        }
        do {_=try await put(Data("HSO2\n".utf8)+JSONEncoder().encode(m),ctx,keys,owner,object,0)}
        catch let e as ExchangeError where e.status==412 {
            try verifyPublished(try await read(ctx,keys,owner,object).0,source:source,type:type,digest:digest)
        }
    }
    func original(_ ctx: JournalObject,_ keys: JournalObject,_ owner: String,_ id: String) async throws -> JournalObject {
        let (bytes,_)=try await read(ctx,keys,owner,"blob-"+id)
        let mime:String,source:Data
        switch try descriptor(bytes) {
        case .legacy(let type,let body):mime=type;source=body
        case .parts(let m):
            let space=try Self.require(ctx["space"])
            let folder=URL.cachesDirectory.appending(path:"HealthStoryPartial/"+Self.digest(Data((space+"/"+owner+"/"+m.token).utf8)))
            try? FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
            var joined=Data();joined.reserveCapacity(m.size)
            for offset in stride(from:0,to:m.size,by:Self.partSize) {
                let index=offset/Self.partSize,name=m.part(index),url=folder.appending(path:String(index))
                let aad=try aad(ctx,owner,name),length=min(Self.partSize,m.size-offset)
                if let saved=try? Data(contentsOf:url),let clear=try? opened(saved,keys:keys,aad:aad),clear.count==length {
                    joined.append(clear);continue
                }
                let (cipher,_)=try await send(ctx,["profiles",owner,name])
                let clear=try opened(cipher,keys:keys,aad:aad)
                guard clear.count==length else {throw JournalError("Получена неполная часть вложения.")}
                try? cipher.write(to:url,options:[.atomic,.completeFileProtection]);joined.append(clear)
            }
            guard Self.digest(joined)==m.sha256 else {throw JournalError("Контрольная сумма оригинала не совпала.")}
            try? FileManager.default.removeItem(at:folder)
            mime=m.mime;source=joined
        }
        return ["id":owner+"/"+id,"type":mime,"bytes":source.base64EncodedString()]
    }
    private static let tagLibraryID="_health_story_family_tags_v1"
    private func readFamilyTags(_ ctx:JournalObject,keys:JournalObject) async throws->([JournalObject],Int) {
        let (bytes,revision)=try await read(ctx,keys,Self.tagLibraryID,"records")
        let document=try jsonObject(bytes)
        guard let tags=document["tags"] as? [JournalObject],
              tags.allSatisfy({$0["id"] is String && $0["name"] is String && $0["keywords"] is [String]}) else {
            throw JournalError("Справочник тегов не удалось прочитать.")
        }
        return (tags,revision)
    }
    func changeFamilyTags(_ ctx:JournalObject,keys:JournalObject,update:([JournalObject])throws->[JournalObject]) async throws->[JournalObject] {
        defer {session.finishTasksAndInvalidate()}
        for attempt in 0..<3 {
            let (before,revision)=try await readFamilyTags(ctx,keys:keys)
            let after=try update(before)
            if try jsonBytes(before)==jsonBytes(after) {return after}
            do {
                _=try await put(jsonBytes(["tags":after]),ctx,keys,Self.tagLibraryID,"records",revision)
                return after
            } catch let failure as ExchangeError where failure.status==412 && attempt<2 {continue}
        }
        throw JournalError("Справочник изменился. Повторите сохранение.")
    }
    static let consentKeys = ["auto","directAuto","chatGPTAuto"]

    static func consent(_ profile: JournalObject) -> [String:Bool] {
        // Match the web format. Older profiles omit the ChatGPT grant.
        var settings = ["auto":profile["auto"] as? Bool == true,"directAuto":profile["directAuto"] as? Bool == true]
        if profile["chatGPTAuto"] as? Bool == true {settings["chatGPTAuto"]=true}
        return settings
    }

    static func records(_ profile: JournalObject) -> JournalObject {
        var cleaned=profile
        for key in consentKeys+["sampleAliases","savedConflicts"] {cleaned.removeValue(forKey:key)}
        for key in ["files","visitDrafts"] {
            if let entries=profile[key] as? [JournalObject] {
                cleaned[key]=entries.map { var e=$0;e.removeValue(forKey:"blobId");return e }
            }
        }
        return cleaned
    }
    func sync(_ payload: JournalObject, mergeScript: String) async throws -> JournalObject {
        defer {session.finishTasksAndInvalidate()}
        var result=payload
        guard var data=payload["data"] as? JournalObject, let access=data["access"] as? JournalObject,
              let device=access["deviceId"] as? String,var ctx=data["sync"] as? JournalObject,
              let oldFamily=data["family"] as? JournalObject, var profiles=data["profiles"] as? [String:JournalObject],
              var states=ctx["profiles"] as? [String:JournalObject] else {throw JournalError("Администратор должен включить обмен и выдать обновлённый файл доступа.")}
        let (cipher,_)=try await send(ctx,["devices",device,"roster"])
        let roster=try jsonObject(opened(cipher,keys:["key":try Self.require(ctx["rosterKey"])],aad:aad(ctx,device,"roster")))
        guard let family=roster["family"] as? JournalObject, let ids=roster["profiles"] as? [String:JournalObject],
              let familyID=family["id"] as? String, familyID==oldFamily["id"] as? String else {throw JournalError("Изменилась семья устройства.")}
        try validateDeviceScope(family:family,access:access,ids:Set(ids.keys))
        profiles=profiles.filter {ids[$0.key] != nil};states=states.filter {ids[$0.key] != nil}
        let files=(payload["files"] as? [JournalObject] ?? []).filter { f in (f["id"] as? String)?.split(separator:"/").first.map { ids[String($0)] != nil } == true }
        let writable=access["role"] as? String != "child"
        let actor=(family["members"] as? [JournalObject])?.first(where:{$0["id"] as? String==access["member"] as? String})?["name"] as? String ?? "iPhone"
        let rules=try DeviceSyncRules(script:mergeScript)
        for (id,keys) in ids {
            var state=states[id] ?? [:], base=state["base"] as? [String:JournalObject] ?? [:]
            var profile=profiles[id] ?? [:]
            var uploaded=Set(state["uploaded"] as? [String] ?? [])
            if writable {
                let localOnly=Set(["files","visitDrafts"].flatMap { field in
                    (profile[field] as? [JournalObject] ?? []).compactMap { $0["syncLocalOnly"] == nil ? nil : ($0["id"] as? String) }
                })
                for f in files {
                    guard let full=f["id"] as? String,full.hasPrefix(id+"/") else {continue}
                    let name=String(full.dropFirst(id.count+1));if uploaded.contains(name) || localOnly.contains(name){continue}
                    guard let original=Data(base64Encoded:f["bytes"] as? String ?? "") else {throw JournalError("Не найден оригинал.")}
                    if original.count>Self.fileLimit {
                        for field in ["files","visitDrafts"] {
                            guard var list=profile[field] as? [JournalObject],let i=list.firstIndex(where:{$0["id"] as? String==name}) else {continue}
                            list[i]["syncLocalOnly"]=["size":original.count,"limit":Self.fileLimit];profile[field]=list
                        }
                        continue
                    }
                    let type=f["type"] as? String ?? "application/octet-stream"
                    try await publishOriginal(original,type:type,ctx:ctx,keys:keys,owner:id,id:name)
                    #if canImport(UIKit)
                    if let thumbnail=NativeDocumentThumbnail.encode(original,type:type) {
                        for field in ["files","visitDrafts"] {
                            guard var list=profile[field] as? [JournalObject],
                                  let index=list.firstIndex(where:{$0["id"] as? String==name}),list[index]["thumbnail"]==nil else {continue}
                            list[index]["thumbnail"]=thumbnail;profile[field]=list
                        }
                    }
                    #endif
                    uploaded.insert(name)
                }
            }
            for lane in ["records","consent"] {
                let (bytes,rev)=try await read(ctx,keys,id,lane)
                guard rev >= (base[lane]?["rev"] as? Int ?? 0) else {throw JournalError("Сервер вернул старую версию.")}
                let remote=try jsonObject(bytes)
                guard var value=remote["value"] as? JournalObject else {throw JournalError("Неполная версия карты.")}
                var cases=remote["conflicts"] as? [JournalObject] ?? [], finalRev=rev
                let child=(family["members"] as? [JournalObject])?.contains {
                    $0["id"] as? String==id && $0["role"] as? String=="Ребёнок"
                } ?? false
                let mayWrite=DeviceSyncRules.permits(role:access["role"] as? String ?? "",member:access["member"] as? String ?? "",owner:id,lane:lane,child:child)
                if mayWrite, let previous=base[lane]?["value"] as? JournalObject {
                    let local=lane=="records" ? Self.records(profile) : Self.consent(profile)
                    let choices=(state["choices"] as? [JournalObject] ?? []).filter{$0["lane"] as? String==lane}
                    let imported=(profile["savedConflicts"] as? [JournalObject] ?? []).filter{$0["lane"] as? String==lane}
                    if try jsonBytes(local) != jsonBytes(previous) || !choices.isEmpty || !imported.isEmpty {
                        let now=ISO8601DateFormatter().string(from:Date())
                        let marks=(state["stamps"] as? [String:JournalObject])?[lane] ?? [:]
                        let update=try rules.reconcile(base:previous,local:local,remote:remote,choices:choices,saved:imported,actor:actor,time:now,marks:marks)
                        guard let combined=update["value"] as? JournalObject,let conflicts=update["conflicts"] as? [JournalObject] else {throw JournalError("Не удалось объединить изменения.")}
                        if try jsonBytes(combined) != jsonBytes(value) || jsonBytes(conflicts) != jsonBytes(cases) {finalRev=try await put(jsonBytes(update),ctx,keys,id,lane,rev)}
                        value=combined;cases=conflicts
                    }
                    if !choices.isEmpty{state["choices"]=(state["choices"] as? [JournalObject] ?? []).filter{$0["lane"] as? String != lane}}
                    if !imported.isEmpty {
                        let rest=(profile["savedConflicts"] as? [JournalObject] ?? []).filter{$0["lane"] as? String != lane}
                        if rest.isEmpty{profile.removeValue(forKey:"savedConflicts")}else{profile["savedConflicts"]=rest}
                    }
                }
                if lane=="consent" {
                    for key in Self.consentKeys {profile.removeValue(forKey:key)}
                    profile.merge(Self.consent(value)){_,new in new}
                } else {
                    profile.merge(value.filter{!Self.consentKeys.contains($0.key)}){_,new in new}
                }
                base[lane]=["rev":finalRev,"value":value,"conflicts":cases]
            }
            for f in (profile["files"] as? [JournalObject] ?? [])+(profile["visitDrafts"] as? [JournalObject] ?? []) {
                if f["syncLocalOnly"]==nil, let name=f["id"] as? String {uploaded.insert(name)}
            }
            state.merge(keys){_,new in new};state["uploaded"]=Array(uploaded);state["base"]=base;state["stamps"]=JournalObject()
            profiles[id]=profile;states[id]=state
        }
        ctx["profiles"]=states;ctx["last"]=ISO8601DateFormatter().string(from:Date())
        data["profiles"]=profiles;data["sync"]=ctx
        for k in ["family","tags","templates","city"] {data[k]=roster[k]}
        if let keys=roster["tagLibrary"] as? JournalObject {
            data["tags"]=try await readFamilyTags(ctx,keys:keys).0
            ctx["tagLibrary"]=keys
        } else {ctx.removeValue(forKey:"tagLibrary")}
        data["sync"]=ctx
        var updated=access;updated["edited"]=false;data["access"]=updated
        let remaining=files.filter{file in
            let address=(file["id"] as? String ?? "").split(separator:"/",maxSplits:1).map(String.init)
            guard address.count==2,let p=profiles[address[0]] else {return false}
            let id=address[1],base=states[address[0]]?["base"] as? [String:JournalObject] ?? [:]
            let locations=["files","visitDrafts"]
            if locations.contains(where:{(p[$0] as? [JournalObject] ?? []).contains{$0["id"] as? String==id}}){return true}
            return (base["records"]?["conflicts"] as? [JournalObject] ?? []).contains { item in
                guard let path=item["path"] as? [Any],let field=path.first as? String,locations.contains(field) else {return false}
                return path.count==1 || (path[1] as? JournalObject)?["id"] as? String==id
            }
        }
        result["data"]=data;result["files"]=remaining;return result
    }
}

func validateDeviceScope(family: JournalObject,access: JournalObject,ids: Set<String>) throws {
    let role=access["role"] as? String ?? "", me=access["member"] as? String ?? ""
    guard family["kind"] as? String=="family",
          let members=family["members"] as? [JournalObject],!members.isEmpty,
          ["child","adult","admin"].contains(role),
          role=="admin" ? family["adminId"] as? String==me : family["adminId"] is NSNull,
          members.count==ids.count,Set(members.compactMap{$0["id"] as? String})==ids,
          members.contains(where:{($0["id"] as? String)==me && ($0["role"] as? String) == (role=="child" ? "Ребёнок":"Взрослый")}),
          members.allSatisfy({member in
              let type=member["role"] as? String ?? ""
              if role=="admin" {return ["Ребёнок","Взрослый"].contains(type)}
              return member["id"] as? String==me || (role=="adult" && type=="Ребёнок")
          }) else {
        throw JournalError("Состав профилей не соответствует выданной роли.")
    }
}

private extension JSONEncoder {
    static var withoutSlashEscaping:JSONEncoder {
        let encoder=JSONEncoder();encoder.outputFormatting = .withoutEscapingSlashes;return encoder
    }
}
