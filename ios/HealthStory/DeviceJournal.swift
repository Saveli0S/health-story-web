import SwiftUI
import UniformTypeIdentifiers
import Network

@MainActor
final class DeviceJournal: ObservableObject {
    @Published private(set) var payload: JournalObject = [:]
    @Published var message: String?
    @Published private(set) var busy=false
    private let exchangeEndpoint:URL
    var runningTreatmentReviews=Set<String>()
    private var disk: DeviceDisk?
    @Published private(set) var hasSavedConnection=false
    private var credentials:DeviceReconnection?
    private var adminArchive: FamilyArchive?
    private var adminFile: URL?
    var hasLocalArchive: Bool {adminArchive != nil}
    var admin: Bool {hasLocalArchive || caption(access,"role")=="admin"}
    func openAdmin(_ archive: FamilyArchive, url: URL) throws {
        guard !paired else {throw JournalError("Сначала откройте выданный профиль устройства.")}
        let contents = try archive.rawPayload()
        adminArchive=archive;adminFile=url;payload=contents;message=nil
    }
    func lockAdmin() {adminArchive=nil;adminFile=nil;payload=[:]}
    func rememberOpenArchiveKeyInCloud() async throws {
        guard let adminArchive else { throw JournalError("Сначала откройте семейный архив.") }
        try await CloudArchiveKeys.remember(adminArchive)
    }
    func exportAdmin() throws -> Data {
        guard let adminArchive,let adminFile else {throw JournalError("Копия доступна администратору.")}
        let bytes=try Data(contentsOf:adminFile)
        try adminArchive.validateBackup(bytes)
        return bytes
    }
    func exportAdmin(recoveryKey:String) async throws -> Data {
        if hasLocalArchive {return try exportAdmin()}
        guard admin,paired,!busy else {throw JournalError("Копия доступна администратору после окончания обмена.")}
        let code=recoveryKey.trim
        guard let key=try? decodeKey(code) else {throw JournalError("Вставьте семейный ключ восстановления целиком.")}
        busy=true;defer{busy=false}
        var snapshot=data
        guard let context=snapshot.removeValue(forKey:"sync") as? JournalObject,
              let states=context["profiles"] as? [String:JournalObject],
              var profiles=snapshot["profiles"] as? [String:JournalObject] else {
            throw JournalError("Для полной копии дождитесь обмена.")
        }
        snapshot.removeValue(forKey:"access")
        let cached=entries(payload,"files")
        var originals=[JournalObject]()
        let exchange=DeviceExchange(endpoint:exchangeEndpoint)
        defer {exchange.session.finishTasksAndInvalidate()}
        for (owner,keys) in states {
            guard var profile=profiles[owner] else {throw JournalError("Не найден профиль для копии.")}
            var kept=entries(profile,"savedConflicts")
            for (lane,version) in keys["base"] as? [String:JournalObject] ?? [:] {
                for var conflict in entries(version,"conflicts") where !kept.contains(where:{caption($0,"id")==caption(conflict,"id")}) {
                    conflict["lane"]=lane;kept.append(conflict)
                }
            }
            if !kept.isEmpty {profile["savedConflicts"]=kept;profiles[owner]=profile}
            for item in entries(profile,"files")+entries(profile,"visitDrafts").filter({$0["manualOnly"] as? Bool != true}) {
                let name=caption(item,"id"), address=owner+"/"+name
                if let original=cached.first(where:{caption($0,"id")==address}) {originals.append(original)}
                else if item["syncLocalOnly"] != nil {
                    throw JournalError("Для полной копии откройте архив на устройстве, где добавили «"+caption(item,"name")+"».")
                } else {originals.append(try await exchange.original(context,keys,owner,name))}
            }
        }
        snapshot["profiles"]=profiles
        let encrypted=try FamilyArchive.seal(["version":2,"data":snapshot,"files":originals],key:key)
        _=try FamilyArchive(encrypted:encrypted,recoveryKey:code)
        return encrypted
    }
    private var timer: Task<Void,Never>?
    private let monitor=NWPathMonitor()
    var data: JournalObject {payload["data"] as? JournalObject ?? [:]}
    var access: JournalObject {data["access"] as? JournalObject ?? [:]}
    var members: [JournalObject] {(data["family"] as? JournalObject)?["members"] as? [JournalObject] ?? []}
    var paired: Bool {!access.isEmpty}
    var editable: Bool {admin || access["role"] as? String=="adult"}
    var pending: Bool {access["edited"] as? Bool==true}
    var last: String? {(data["sync"] as? JournalObject)?["last"] as? String}
    func profile(_ id: String) -> JournalObject {(data["profiles"] as? [String:JournalObject])?[id] ?? [:]}
    init(exchangeEndpoint:URL=DeviceExchange.cloud) {
        self.exchangeEndpoint=exchangeEndpoint
        do {let vault=try DeviceDisk();disk=vault;payload=try vault.load() ?? [:]}
        catch {message=error.localizedDescription}
        if paired {rememberConnection()}
        else if payload.isEmpty && message==nil {
            credentials=try? DeviceReconnection.read()
            hasSavedConnection=credentials != nil
        }
        monitor.pathUpdateHandler={ [weak self] path in
            if path.status == .satisfied {Task {@MainActor in self?.schedule()}}
        }
        monitor.start(queue:DispatchQueue(label:"healthstory.network"))
    }
    deinit {monitor.cancel();timer?.cancel()}
    func schedule() {
        guard data["sync"] != nil else {return}
        timer?.cancel()
        timer=Task {try? await Task.sleep(for:.seconds(1)); if !Task.isCancelled {await sync()} }
    }
    private func commit(_ candidate: JournalObject) throws {
        if let adminArchive, let adminFile {
            let encrypted=try adminArchive.seal(candidate)
            try encrypted.write(to:adminFile,options:[.atomic,.completeFileProtection])
            payload=candidate;return
        }
        guard let disk else {throw JournalError("Локальное хранилище недоступно.")}
        try disk.save(candidate);payload=candidate
    }
    func install(_ packet: Data, code: String, identity: DeviceIdentity) throws {
        guard !busy else {throw JournalError("Дождитесь окончания обмена.")}
        let candidate=try identity.openPacket(packet,code:code)
        guard candidate["version"] as? Int==2,let d=candidate["data"] as? JournalObject,
              let family=d["family"] as? JournalObject,let grant=d["access"] as? JournalObject,
              let patients=d["profiles"] as? [String:JournalObject],let revision=grant["revision"] as? Int, revision>0,
              grant["deviceId"] as? String==identity.id,grant["edited"] as? Bool==false,
              let originals=candidate["files"] as? [JournalObject] else {throw JournalError("Некорректный файл доступа.")}
        try validateDeviceScope(family:family,access:grant,ids:Set(patients.keys))
        if paired {
            guard (data["family"] as? JournalObject)?["id"] as? String == family["id"] as? String,
                  access["member"] as? String==grant["member"] as? String,access["role"] as? String==grant["role"] as? String,
                  revision>(access["revision"] as? Int ?? 0),!pending else {throw JournalError("Сначала передайте свои изменения и выберите новый файл доступа этой семьи.")}
        }
        var expected=Set<String>()
        for (id,p) in patients {
            guard let files=p["files"] as? [JournalObject] else {throw JournalError("Некорректная медкарта.")}
            for f in files+entries(p,"visitDrafts").filter({$0["manualOnly"] as? Bool != true}) {
                guard let name=f["id"] as? String,!name.isEmpty,!name.contains("/"),expected.insert(id+"/"+name).inserted else {throw JournalError("Некорректная ссылка на оригинал.")}
            }
        }
        if let ctx=d["sync"] as? JournalObject {
            guard originals.isEmpty,let states=ctx["profiles"] as? [String:JournalObject],Set(states.keys)==Set(patients.keys) else {throw JournalError("Неверная область обмена.")}
        } else {
            guard caption(grant,"role") != "admin" else {throw JournalError("Для подключения администратора включите обмен в веб-дневнике.")}
            for f in originals {
                guard let id=f["id"] as? String,expected.remove(id) != nil,let b=f["bytes"] as? String,let raw=Data(base64Encoded:b),!raw.isEmpty else {throw JournalError("Неполные оригиналы.")}
            }
            guard expected.isEmpty else {throw JournalError("Не все вложения присутствуют в файле.")}
        }
        try commit(candidate);message=nil;rememberConnection();schedule()
    }
    private func rememberConnection() {
        let current=DeviceReconnection(journal:payload)
        do {
            try DeviceReconnection.save(current)
            credentials=current;hasSavedConnection=current != nil
        } catch {message=error.localizedDescription}
    }
    private func mergeScript() throws -> String {
        guard let url=Bundle.main.url(forResource:"sync-merge",withExtension:"js") else {
            throw JournalError("Не найден модуль объединения правок.")
        }
        return try String(contentsOf:url,encoding:.utf8)
    }
    func reconnect() async {
        guard !busy,!paired,!admin,payload.isEmpty,let credentials else{return}
        busy=true;defer{busy=false}
        do {
            guard try DeviceIdentity().id==credentials.deviceID else {
                throw JournalError("Ключ устройства недоступен. Получите новый файл доступа.")
            }
            let script=try mergeScript()
            let exchange=DeviceExchange(endpoint:exchangeEndpoint)
            let synced=try await exchange.sync(credentials.emptyJournal,mergeScript:script)
            try commit(synced);message=nil
        } catch let failure as ExchangeError where failure.status==403 || failure.status==404 {
            message="Сохранённый доступ больше не действует. Получите новый файл доступа у администратора."
        } catch {message=error.localizedDescription}
    }
    func sync() async {
        guard !busy,paired,data["sync"] != nil else {return}
        busy=true;defer {busy=false}
        do {
            let script=try mergeScript()
            for attempt in 0..<3 {
                do {try commit(await DeviceExchange(endpoint:exchangeEndpoint).sync(payload,mergeScript:script));break}
                catch let e as ExchangeError where e.status==412 && attempt<2 {continue}
            }
            message=nil
        } catch {message=error.localizedDescription}
    }
    func attachment(owner:String, id:String) async throws -> FamilyArchive.Original {
        let name=owner+"/"+id
        try await saveOffline(owner:owner,ids:[id])
        guard let entry=entries(payload,"files").first(where:{caption($0,"id")==name}),
              let bytes=Data(base64Encoded:caption(entry,"bytes")) else {throw JournalError("Вложение повреждено.")}
        return .init(id:name,type:entry["type"] as? String ?? "",bytes:bytes)
    }

    func saveOffline(owner:String, ids:[String], progress:(Int)->Void = {_ in}) async throws {
        let p=profile(owner)
        let allowed=entries(p,"files")+(editable ? entries(p,"visitDrafts").filter{$0["manualOnly"] as? Bool != true}:[])
        guard ids.allSatisfy({id in !id.isEmpty && allowed.contains{caption($0,"id")==id}}) else {
            throw JournalError("Документ недоступен.")
        }
        let cached=cachedIDs(owner)
        if ids.allSatisfy(cached.contains) {progress(ids.count);return}
        guard !busy,let ctx=data["sync"] as? JournalObject,
              let keys=(ctx["profiles"] as? [String:JournalObject])?[owner] else {
            throw JournalError("Дождитесь обмена или подключитесь к сети.")
        }
        busy=true
        let exchange=DeviceExchange(endpoint:exchangeEndpoint)
        defer {
            exchange.session.finishTasksAndInvalidate();busy=false
            if pending {schedule()}
        }
        var saved=cached, failed=[String](), firstError:Error?
        for (index,id) in ids.enumerated() {
            try Task.checkCancellation()
            do {
                if !saved.contains(id) {
                    if allowed.first(where:{caption($0,"id")==id})?["syncLocalOnly"] != nil {
                        throw JournalError("Оригинал больше 128 МиБ. Откройте его на устройстве добавления или восстановите полную локальную копию.")
                    }
                    let original=try await exchange.original(ctx,keys,owner,id)
                    try Task.checkCancellation()
                    var next=payload
                    next["files"]=entries(next,"files")+[original]
                    try commit(next)
                    saved.insert(id)
                }
            } catch {
                try Task.checkCancellation()
                if firstError==nil {firstError=error}
                failed.append(allowed.first(where:{caption($0,"id")==id}).map{caption($0,"name")} ?? id)
            }
            progress(index+1)
        }
        if let firstError {
            if ids.count==1 {throw firstError}
            throw JournalError("Не удалось сохранить \(failed.count) из \(ids.count): \(failed.joined(separator:", ")). \(firstError.localizedDescription)")
        }
    }

    var pendingProfiles:[(name:String, changes:[String])] {
        guard editable else {return []}
        let profiles=data["profiles"] as? [String:JournalObject] ?? [:]
        return members.compactMap { member in
            let owner=caption(member,"id"),state=syncState(owner)
            guard let profile=profiles[owner],let base=state["base"] as? [String:JournalObject] else {return nil}
            var changes=[String]()
            for (lane,label,value) in [("records","Изменения в карточке",DeviceExchange.records(profile)),
                                       ("consent","Настройки передачи в ИИ",DeviceExchange.consent(profile) as JournalObject)] {
                guard mayResolve(owner,lane:lane),let previous=base[lane]?["value"] as? JournalObject else {continue}
                if (try? jsonBytes(value)) != (try? jsonBytes(previous)) {changes.append(label)}
            }
            if !entries(state,"choices").isEmpty || !entries(profile,"savedConflicts").isEmpty {changes.append("Решения по расхождениям")}
            let waiting=cachedIDs(owner).subtracting(state["uploaded"] as? [String] ?? [])
            for file in entries(profile,"files")+entries(profile,"visitDrafts") where file["syncLocalOnly"]==nil && waiting.contains(caption(file,"id")) {
                changes.append("Оригинал · "+caption(file,"name"))
            }
            return changes.isEmpty ? nil : (caption(member,"name"),changes)
        }
    }
    private func syncState(_ owner:String) -> JournalObject {
        ((data["sync"] as? JournalObject)?["profiles"] as? [String:JournalObject])?[owner] ?? [:]
    }
    func conflicts(_ owner:String) -> [JournalObject] {
        let state=syncState(owner),base=state["base"] as? [String:JournalObject] ?? [:]
        var conflicts=entries(profile(owner),"savedConflicts")
        for lane in ["records","consent"] {
            for var c in entries(base[lane] ?? [:],"conflicts") where !conflicts.contains(where:{caption($0,"id")==caption(c,"id") && caption($0,"lane")==lane}) {
                c["lane"]=lane;conflicts.append(c)
            }
        }
        return conflicts
    }
    func queuedSide(_ owner:String,conflict:JournalObject) -> String? {
        entries(syncState(owner),"choices").last{caption($0,"id")==caption(conflict,"id") && caption($0,"lane")==caption(conflict,"lane")}?["side"] as? String
    }
    func mayResolve(_ owner:String,lane:String) -> Bool {
        guard let member=members.first(where:{caption($0,"id")==owner}) else {return false}
        return DeviceSyncRules.permits(role:caption(access,"role"),member:caption(access,"member"),owner:owner,lane:lane,
                                       admin:hasLocalArchive,child:caption(member,"role")=="Ребёнок")
    }
    func resolve(_ owner:String,id:String,lane:String,side:String) throws {
        guard !busy,["local","remote"].contains(side),mayResolve(owner,lane:lane),
              let c=conflicts(owner).first(where:{caption($0,"id")==id && caption($0,"lane")==lane}) else {throw JournalError("Запись изменилась или выбор недоступен.")}
        var d=data
        if var ctx=d["sync"] as? JournalObject,var states=ctx["profiles"] as? [String:JournalObject],var state=states[owner] {
            var choices=entries(state,"choices").filter{!(caption($0,"lane")==lane && caption($0,"id")==id)}
            choices.append(["id":id,"lane":lane,"side":side]);state["choices"]=choices;states[owner]=state;ctx["profiles"]=states;d["sync"]=ctx
            if paired {var a=access;a["edited"]=true;d["access"]=a}
            var next=payload;next["data"]=d;try commit(next);schedule()
        } else {
            let rules=try DeviceSyncRules()
            try changeProfile(owner){p in
                p=try rules.choose(profile:p,conflict:c,side:side)
                let left=entries(p,"savedConflicts").filter{!(caption($0,"lane")==lane && caption($0,"id")==id)}
                if left.isEmpty{p.removeValue(forKey:"savedConflicts")}else{p["savedConflicts"]=left}
            }
        }
    }
    private func commitEdit(_ candidate:JournalObject,owner:String) throws {
        var next=candidate
        if var d=next["data"] as? JournalObject,var ctx=d["sync"] as? JournalObject,var states=ctx["profiles"] as? [String:JournalObject],var state=states[owner],
           let updated=(d["profiles"] as? [String:JournalObject])?[owner] {
            let rules=try DeviceSyncRules(),before=profile(owner)
            var stamps=state["stamps"] as? [String:JournalObject] ?? [:]
            let actor=members.first{caption($0,"id")==NativePromptLibrary.actor(self)}?["name"] as? String ?? "iPhone", time=ISO8601DateFormatter().string(from:Date())
            stamps["records"]=try rules.marked(before:DeviceExchange.records(before),after:DeviceExchange.records(updated),original:stamps["records"] ?? [:],author:actor,time:time)
            let oldConsent=DeviceExchange.consent(before)
            let newConsent=DeviceExchange.consent(updated)
            if oldConsent != newConsent {stamps["consent"]=try rules.marked(before:oldConsent,after:newConsent,original:stamps["consent"] ?? [:],author:actor,time:time)}
            state["stamps"]=stamps;states[owner]=state;ctx["profiles"]=states;d["sync"]=ctx;next["data"]=d
        }
        try commit(next);schedule()
    }
    func cachedIDs(_ owner:String) -> Set<String> {
        let prefix=owner+"/"
        return Set((payload["files"] as? [JournalObject] ?? []).compactMap{row in
            guard let name=row["id"] as? String,name.hasPrefix(prefix) else {return nil}
            return String(name.dropFirst(prefix.count))
        })
    }
    func changeProfile(_ owner:String, originals:[NativeUpload]=[], pruneOriginals:Bool=false, _ update:(inout JournalObject)throws->Void) throws {
        guard !busy,editable,members.contains(where:{$0["id"] as? String==owner}) else {throw JournalError("Нет доступа к записи или идёт обмен.")}
        var d=data,profiles=d["profiles"] as? [String:JournalObject] ?? [:]
        guard var p=profiles[owner] else {throw JournalError("Профиль недоступен.")}
        try update(&p);profiles[owner]=p;d["profiles"]=profiles
        if paired {var a=access;a["edited"]=true;d["access"]=a}
        var next=payload;next["data"]=d
        if pruneOriginals {
            let prefix=owner+"/"
            let retained=Set((entries(p,"files")+entries(p,"visitDrafts")).map{prefix+caption($0,"id")})
            next["files"]=entries(next,"files").filter{row in
                let id=caption(row,"id")
                return !id.hasPrefix(prefix) || retained.contains(id)
            }
        }
        if !originals.isEmpty {
            var files=next["files"] as? [JournalObject] ?? []
            for file in originals {
                guard !file.bytes.isEmpty else {throw JournalError("Выбран пустой файл.")}
                let ref=owner+"/"+file.id
                if !files.contains(where:{caption($0,"id")==ref}) {
                    files.append(["id":ref,"type":file.mime,"bytes":file.bytes.base64EncodedString()])
                }
            }
            next["files"]=files
        }
        try commitEdit(next,owner:owner)
    }
    var canManageFamilyTags:Bool {
        admin && (hasLocalArchive || (data["sync"] as? JournalObject)?["tagLibrary"] is JournalObject)
    }
    func changeFamilyTags(_ update:([JournalObject])throws->[JournalObject]) async throws {
        guard canManageFamilyTags,!busy else {throw JournalError("Справочник доступен после обмена с веб-дневником администратора.")}
        busy=true;defer{busy=false}
        var next=data
        if hasLocalArchive {
            next["tags"]=try update(entries(next,"tags"))
        } else {
            guard let ctx=next["sync"] as? JournalObject,let keys=ctx["tagLibrary"] as? JournalObject else {
                throw JournalError("Справочник тегов недоступен.")
            }
            next["tags"]=try await DeviceExchange(endpoint:exchangeEndpoint).changeFamilyTags(ctx,keys:keys,update:update)
        }
        var candidate=payload;candidate["data"]=next
        try commit(candidate)
    }
    func saveFamilyTemplate(_ item:JournalObject,remove:Bool=false) throws {
        guard hasLocalArchive,!busy else {throw JournalError("Общие промпты подключённой семьи изменяются в веб-дневнике.")}
        var d=data,next=payload
        let key=caption(item,"id")
        var templates=entries(d,"templates").filter{caption($0,"id") != key}
        if !remove {templates.append(item)}
        d["templates"]=templates;next["data"]=d;try commit(next)
    }
    func matchingOriginal(owner:String, file:NativeUpload, digest:String, rows:[JournalObject]) -> JournalObject? {
        rows.first { row in
            if let known=row["sourceDigest"] as? String,!known.isEmpty {return known==digest}
            guard ClinicalDuplicates.text(caption(row,"name"))==ClinicalDuplicates.text(file.name),
                  let item=entries(payload,"files").first(where:{caption($0,"id")==owner+"/"+caption(row,"id")}),
                  let bytes=Data(base64Encoded:caption(item,"bytes")), bytes.count==file.bytes.count else {return false}
            return bytes==file.bytes
        }
    }
    func editVisit(owner:String, expected:[Any], title:String, day:String, doctor:String, clinic:String, note:String) throws {
        let id=NativeTreatments.field(expected,0)
        try changeProfile(owner){p in
            var visits=p["addedVisits"] as? [[Any]] ?? []
            guard let index=visits.firstIndex(where:{$0.first as? String==id}),visits[index].count>=6,
                  !title.trim.isEmpty,CoursePeriod.date(day) != nil,day<=dayString() else {throw JournalError("Проверьте название и дату визита.")}
            let doctors=entries(p,"addedDoctors")
            guard doctors.contains(where:{caption($0,"id")==doctor}) || visits[index][3] as? String==doctor else {throw JournalError("Врач недоступен.")}
            let old=visits[index]
            guard [1,2,3,5,9].allSatisfy({NativeTreatments.field(old,$0)==NativeTreatments.field(expected,$0)}) else {
                throw JournalError("Визит уже изменился. Откройте актуальную карточку перед сохранением.")
            }
            var updated=old
            updated[1]=day;updated[2]=title.trim;updated[3]=doctor;updated[5]=note.trim
            while updated.count<8 {updated.append("")}
            if updated.count==8 {updated.append([JournalObject]())}
            if updated.count==9 {updated.append(clinic.trim)} else {updated[9]=clinic.trim}
            let key=ClinicalDuplicates.visit(updated,doctors:doctors)
            if key != ClinicalDuplicates.visit(old,doctors:doctors),
               let match=visits.first(where:{$0.first as? String != id && ClinicalDuplicates.visit($0,doctors:doctors)==key}),
               let existing=match.first as? String {throw DuplicateClinicalCard(id:existing)}
            visits[index]=updated;p["addedVisits"]=visits
        }
    }
    func renameEpisode(owner:String,id:String,name:String) throws {
        try changeProfile(owner){p in
            var episodes=entries(p,"episodes")
            guard let index=episodes.firstIndex(where:{caption($0,"id")==id}),!name.trim.isEmpty else {throw JournalError("Введите название эпизода.")}
            let key=ClinicalDuplicates.text(name)
            if key != ClinicalDuplicates.text(caption(episodes[index],"name")),
               let duplicate=episodes.first(where:{caption($0,"id") != id && ClinicalDuplicates.text(caption($0,"name"))==key}) {
                throw DuplicateClinicalCard(id:caption(duplicate,"id"))
            }
            episodes[index]["name"]=name.trim;p["episodes"]=episodes
            p["addedVisits"]=(p["addedVisits"] as? [[Any]] ?? []).map{row in
                guard row.count>=8,row[7] as? String==id else {return row}
                var updated=row;updated[4]=name.trim;return updated
            }
        }
    }
    @discardableResult
    func saveVisit(owner:String, draft: NativeVisitDraft, expectedDraft:[JournalObject]=[]) throws -> String {
        guard !busy,editable, members.contains(where:{$0["id"] as? String==owner}),!draft.title.trim.isEmpty,
              !draft.episode.trim.isEmpty else {throw JournalError("Проверьте название визита, эпизод и права записи.")}
        var d=data, p=profile(owner), profiles=d["profiles"] as? [String:JournalObject] ?? [:]
        if draft.files.contains(where:{$0.readCategory != nil}),!draft.checked {throw JournalError("Сверьте распознанные поля с оригиналами.")}
        if expectedDraft.isEmpty,let first=draft.files.first {try VisitDrafts.check(p,id:first.id,expected:[])}
        if let first=expectedDraft.first {
            let id=caption(first,"id")
            try VisitDrafts.check(p,id:id,expected:expectedDraft)
            p["visitDrafts"]=entries(p,"visitDrafts").filter{caption($0,"id") != id && caption($0,"parent") != id}
        }
        let visitID=UUID().uuidString
        var episodes=p["episodes"] as? [JournalObject] ?? []
        let knownEpisode=episodes.first(where:{$0["id"] as? String==draft.episodeID}) ??
            episodes.first(where:{draft.episodeID==nil && ClinicalDuplicates.text(caption($0,"name"))==ClinicalDuplicates.text(draft.episode)})
        if draft.episodeID != nil && knownEpisode==nil {throw JournalError("Выбранный эпизод недоступен.")}
        let ep=knownEpisode ?? ["id":UUID().uuidString,"name":draft.episode.trim]
        if knownEpisode==nil {episodes.append(ep)}
        var doctors=p["addedDoctors"] as? [JournalObject] ?? []
        var doctorID=draft.doctorSelection
        if doctorID=="new" {
            let values=[draft.doctor.trim,draft.specialty.trim,draft.clinic.trim]
            guard !values[0].isEmpty else {throw JournalError("Введите ФИО врача или выберите «Врач не указан».")}
            let key=values.map(ClinicalDuplicates.text)
            if let existing=doctors.first(where:{($0["values"] as? [String])?.map(ClinicalDuplicates.text)==key}) {
                doctorID=caption(existing,"id")
            } else {
                doctorID=UUID().uuidString;doctors.append(["id":doctorID,"values":values])
            }
        } else if !doctorID.isEmpty && !doctors.contains(where:{caption($0,"id")==doctorID}) {
            throw JournalError("Выберите доступного врача.")
        }
        let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.calendar=Calendar(identifier:.gregorian);formatter.dateFormat="yyyy-MM-dd"
        let day=formatter.string(from:draft.date)
        var row:[Any]=[visitID,day,draft.title.trim,doctorID,ep["name"]!,draft.note.trim,"scope",ep["id"]!]
        if !draft.medicines.isEmpty || !draft.clinic.trim.isEmpty {row.append(try draft.medicines.map {try $0.record()})}
        if !draft.clinic.trim.isEmpty {row.append(draft.clinic.trim)}
        let visits=p["addedVisits"] as? [[Any]] ?? []
        let key=ClinicalDuplicates.visit(row,doctors:doctors)
        if let match=visits.first(where:{ClinicalDuplicates.visit($0,doctors:doctors)==key}),let existing=match.first as? String {
            throw DuplicateClinicalCard(id:existing)
        }
        let source=draft.files.first(where:{$0.category=="Назначения"})
        let existingFiles=entries(p,"files")
        var digests=[String:String]()
        for file in draft.files {
            guard digests[file.id]==nil else {throw JournalError("В комплекте повторяется один и тот же оригинал.")}
            digests[file.id]=ClinicalDuplicates.digest(file.bytes)
        }
        if let source,
           let digest=digests[source.id],
           let used=matchingOriginal(owner:owner,file:source,digest:digest,
                                     rows:existingFiles.filter(ClinicalDuplicates.visitSource)),
           !caption(used,"visit").isEmpty {
            let linked=existingFiles.filter{caption($0,"visit")==caption(used,"visit")}
            if draft.files.allSatisfy({file in
                guard let digest=digests[file.id] else {return false}
                return matchingOriginal(owner:owner,file:file,digest:digest,rows:linked) != nil
            }) {throw DuplicateClinicalCard(id:caption(used,"visit"))}
        }
        p["addedVisits"]=[row]+visits
        p["episodes"]=episodes;p["addedDoctors"]=doctors
        if !draft.recommendation.trim.isEmpty {p["recommendations"]=(p["recommendations"] as? [JournalObject] ?? [])+[["id":UUID().uuidString,"visit":visitID,"text":draft.recommendation.trim]]}
        var originals=payload["files"] as? [JournalObject] ?? [], files=p["files"] as? [JournalObject] ?? []
        var seen=Set<String>()
        for upload in draft.files {
            guard !upload.bytes.isEmpty else {throw JournalError("Выбран пустой файл.")}
            var item:JournalObject=["id":upload.id,"visit":visitID,"category":upload.category,"date":day,"type":upload.mime,"name":upload.name]
            guard let digest=digests[upload.id],seen.insert(digest).inserted else {continue}
            item["sourceDigest"]=digest
            if upload.id==source?.id {item["visitSource"]=true}
            if upload.category=="Лаборатория",let lab=upload.lab {
                let key=ClinicalDuplicates.lab(lab.json)
                let match=lab.date.isEmpty ? nil:files.first{($0["lab"] as? JournalObject).map(ClinicalDuplicates.lab)==key}
                if lab.verified && draft.checked && match==nil {item["lab"]=lab.json}
                else {
                    item["labDraft"]=lab.json
                    if let match {item["duplicateLab"]=caption(match,"id")}
                }
            }
            if !upload.raw.isEmpty {
                item[upload.category=="Лаборатория" ? "labRaw":"raw"]=upload.raw
            }
            if let transcript=upload.transcription {item["transcription"]=transcript}
            if !upload.issues.isEmpty {item["issues"]=upload.issues}
            files.append(item)
            if !originals.contains(where:{caption($0,"id")==owner+"/"+upload.id}) {
                originals.append(["id":owner+"/"+upload.id,"type":upload.mime,"bytes":upload.bytes.base64EncodedString()])
            }
        }
        p["files"]=files
        if !draft.medicines.isEmpty {
            p["treatmentQueue"]=entries(p,"treatmentQueue")+[["id":visitID,"time":ISO8601DateFormatter().string(from:Date())]]
        }
        profiles[owner]=p;d["profiles"]=profiles
        if paired {var a=access;a["edited"]=true;d["access"]=a}
        var next=payload;next["data"]=d;next["files"]=originals;try commitEdit(next,owner:owner)
        return visitID
    }
}
extension String {var trim:String {trimmingCharacters(in:.whitespacesAndNewlines)}}
struct NativeUpload: Identifiable {var id=UUID().uuidString;var category="Назначения";let name:String;let mime:String;let bytes:Data;var raw="";var transcription:String?;var lab:LabResult?;var hasRecommendation=false;var issues:[[String:Any]]=[];var warnings:[String]=[];var readCategory:String?}
struct NativeMedicine: Identifiable {
    var id=UUID().uuidString;var name="",strength="",form="",instructions=""
    func field(_ name:String) -> String {"medicine-\(id)-\(name)"}
    var validationIssues:[JournalFieldIssue] {
        [("name",name,"Уточните название лекарства."),
         ("strength",strength,"Уточните дозировку."),
         ("instructions",instructions,"Уточните схему приёма.")].compactMap { key,value,message in
            let valid=value.rangeOfCharacter(from:.alphanumerics) != nil &&
                value.range(of:"[?？�]|неразборчив|уточнить|неизвестн|не\\s+указан",options:[.regularExpression,.caseInsensitive])==nil
            return valid ? nil : JournalFieldIssue(field:field(key),message:message)
        }
    }
    func record() throws -> JournalObject {
        if let issue=validationIssues.first {throw JournalError(issue.message)}
        return ["id":id,"name":name.trim,"strength":strength.trim,"form":form.trim,"instructions":instructions.trim,"period":["start":"","end":"","planned":"","unknown":false,"closed":false] as JournalObject]
    }
}
struct NativeVisitDraft {
    var sourcePosition=NativeSourcePosition()
    var title="",episode="",specialty="",doctor="",clinic="",note="",recommendation=""
    var doctorSelection="new"
    var recognizedDate=false
    var checked=false;var episodeID:String?, date=Date(),medicines:[NativeMedicine]=[],files:[NativeUpload]=[]
}
