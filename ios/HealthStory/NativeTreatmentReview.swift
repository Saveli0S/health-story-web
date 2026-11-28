import SwiftUI
import JavaScriptCore

/// The journal stores the same review, transfer and package records as the web client.
struct TreatmentRules {
    let parser:ClinicalImport
    init(names:[String]=[], metadata:[String]=[]) throws {
        parser=try ClinicalImport()
        let js=parser.js
        js.setObject(names,forKeyedSubscript:"nativeNames" as NSString)
        js.setObject(metadata,forKeyedSubscript:"nativeMetadata" as NSString)
        // JavaScriptCore has no browser URL implementation. Foundation parses links;
        // treatment.js applies the same evidence-link policy as it does on the web.
        let parts:@convention(block)(String)->NSDictionary? = { value in
            guard let u=URLComponents(string:value),let scheme=u.scheme,let host=u.host,let href=u.url?.absoluteString else{return nil}
            return ["protocol":scheme.lowercased()+":","hostname":host.lowercased(),"username":u.user ?? "","password":u.password ?? "","port":u.port.map(String.init) ?? "","pathname":u.path.isEmpty ? "/":u.path,"hash":u.fragment ?? "","href":href,"keys":(u.queryItems ?? []).map(\.name)] as NSDictionary
        }
        js.setObject(parts,forKeyedSubscript:"nativeURL" as NSString)
        js.evaluateScript("""
        class URL {
          constructor(input) {
            const u=nativeURL(input); if(!u)throw new Error('URL');
            Object.assign(this,u); this.searchParams={has:k=>u.keys.includes(k)};
          }
        }
        function norm(value){return String(value||'').toLocaleLowerCase('ru').replaceAll('ё','е').trim()}
        function cleanClinicalText(value){
          let result=String(value);
          for(const token of nativeMetadata)if(token.length>=3)result=result.replaceAll(new RegExp(token.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&'),'giu'),'[скрыто]');
          return anonymizeClinicalText(result,nativeNames);
        }
        function cleanSnapshot(json){return JSON.parse(JSON.stringify(json,(_,v)=>typeof v==='string'?cleanClinicalText(v):v))}
        """)
        guard js.exception==nil,let url=Bundle.main.url(forResource:"treatment",withExtension:"js") else {throw JournalError("Модуль разбора лечения недоступен.")}
        js.evaluateScript(try String(contentsOf:url,encoding:.utf8))
        guard js.exception==nil else {throw JournalError("Не удалось загрузить правила разбора.")}
    }
    func call(_ name:String,_ args:[Any]) throws -> JSValue {
        let js=parser.js
        js.exception=nil
        guard let fn=js.objectForKeyedSubscript(name),!fn.isUndefined,let result=fn.call(withArguments:args),js.exception==nil,!result.isUndefined else {throw JournalError("Не удалось применить правила разбора.")}
        return result
    }
    func clean(_ text:String)throws->String {try call("cleanClinicalText",[text]).toString()}
    func items(_ row:JournalObject)throws->[JournalObject] {
        guard let rows=try call("effectiveReviewItems",[row]).toArray() as? [JournalObject] else {throw JournalError("Ответ не удалось разобрать.")}
        return rows
    }
    static func make(_ p:JournalObject,members:[JournalObject]) throws->TreatmentRules {
        var metadata=entries(p,"files").map{caption($0,"name")}
        metadata += entries(p,"exams").map{caption($0,"clinic")}
        metadata += NativeTreatments.visits(p).map{NativeTreatments.field($0,9)}
        metadata += entries(p,"addedDoctors").compactMap{($0["values"] as? [String]).flatMap{$0.count>2 ? $0[2] : nil}}
        metadata += entries(p,"files").compactMap{($0["lab"] as? JournalObject).map{caption($0,"laboratory")}}
        return try TreatmentRules(names:ConsultationDraft.knownNames(members:members,profile:p),metadata:Array(Set(metadata)).sorted{$0.count>$1.count})
    }
    static func rx(_ med:JournalObject)->JournalObject {
        ["название":caption(med,"name"),"дозировка":caption(med,"strength"),"форма":caption(med,"form"),"схема":caption(med,"instructions")]
    }
    static func drugs(_ visit:String,_ p:JournalObject)->[JournalObject] {
        var rows=NativeTreatments.all(p).filter{$0.visit==visit}.map(\.medicine)
        for change in entries(p,"changes") where caption(change,"visit")==visit && caption(change,"kind")=="continue" {
            if let previous=change["before"] as? JournalObject,!rows.contains(where:{NativeTreatments.signature($0)==NativeTreatments.signature(previous)}) {rows.append(previous)}
        }
        return rows
    }
    func payload(_ visit:String,_ p:JournalObject)throws->JournalObject {
        let all=NativeTreatments.visits(p)
        guard let row=all.first(where:{NativeTreatments.field($0,0)==visit}) else {throw JournalError("Визит недоступен.")}
        let date=NativeTreatments.field(row,1), drugs=Self.drugs(visit,p)
        let files=entries(p,"files").filter{caption($0,"visit")==visit}
        guard !files.contains(where:{($0["intake"] as? Bool==true && $0["checked"] as? Bool != true) || (caption($0,"category")=="Лаборатория" && ($0["lab"]==nil || $0["labDraft"] != nil))}) else {throw JournalError("Сначала сверьте назначения и лабораторные бланки этого визита.")}
        guard !drugs.isEmpty else {throw JournalError("Для разбора добавьте назначенные врачом препараты.")}
        guard drugs.allSatisfy({m in ["name","strength","instructions"].allSatisfy{k in let v=caption(m,k); return v.range(of:"[\\p{L}\\d]",options:.regularExpression) != nil && v.range(of:"[?？�]|неразборчив|уточнить",options:[.regularExpression,.caseInsensitive])==nil}}) else {throw JournalError("Сверьте название, дозировку и схему каждого препарата с оригиналом.")}
        func field(_ key:String)->String {entries(p,"fields").first{caption($0,"id")==key}.map{caption($0,"value")} ?? ""}
        var patient:JournalObject=["Возраст на дату визита":"Не указан"]
        if let b=CoursePeriod.date(field("birthday")),let d=CoursePeriod.date(date), b<=d, let years=Calendar(identifier:.gregorian).dateComponents([.year],from:b,to:d).year {
            let last=years%10,teens=(11...14).contains(years%100)
            patient["Возраст на дату визита"]="\(years) "+(teens ? "лет":last==1 ? "год":(2...4).contains(last) ? "года":"лет")
        }
        for (id,key) in [("height","Рост"),("weight","Вес"),("chronic","Хронические заболевания"),("allergy","Аллергии")] where !field(id).isEmpty {
            if id=="height" || id=="weight" {guard !field("measured").isEmpty,field("measured")<=date else {continue}}
            patient[key]=field(id)
        }
        let decisions=entries(p,"changes").filter{caption($0,"visit")==visit}
        let concurrent=NativeTreatments.all(p).filter{c in
            c.visit != visit && c.date<=date && !c.continued && !c.period.start.isEmpty && c.period.start<=date &&
            (!c.period.closed || c.period.end>=date) && (c.change==nil || caption(c.change ?? [:],"date")>date) &&
            !decisions.contains(where:{caption($0,"source")==c.visit && caption($0,"medId")==caption(c.medicine,"id")})
        }
        if !concurrent.isEmpty {patient["Другие курсы на дату визита"]=concurrent.map{Self.rx($0.medicine)}}
        var labs=[JournalObject]()
        for file in files {
            guard let lab=file["lab"] as? JournalObject else {continue}
            for r in entries(lab,"rows"){labs.append(["датаОбразца":caption(lab,"date"),"исследование":caption(lab,"name"),"показатель":caption(r,"name"),"результат":caption(r,"value"),"единица":caption(r,"unit"),"материал":caption(r,"specimen"),"диапазон":caption(r,"range")])}
        }
        let rec=entries(p,"recommendations").filter{caption($0,"visit")==visit}.map{caption($0,"text")} + files.filter{$0["checked"] as? Bool==true}.map{caption($0,"recommendation")}
        var data:JournalObject=["пациент":patient,"эпизод":NativeTreatments.field(row,4),"запись":NativeTreatments.field(row,5),"назначения":drugs.map(Self.rx),"анализы":labs,"рекомендацииВрача":rec.filter{!$0.isEmpty},"сведенияИзДокументов":files.flatMap{f in [(f["checked"] as? Bool==true ? caption(f,"context"):""),(caption(f,"category")=="Заключения" ? caption(f,"clinicalText"):"")]}.filter{!$0.isEmpty},
            "измененияСхемы":decisions.map{c in ["решение":caption(c,"kind"),"ранее":Self.rx(c["before"] as? JournalObject ?? [:]),"назначено":Self.rx(c["replacement"] as? JournalObject ?? [:])] as JournalObject}]
        let previous=all.filter{NativeTreatments.episode($0,p)==NativeTreatments.episode(row,p) && NativeTreatments.field($0,1)<date}
        if !previous.isEmpty {data["предыдущиеВизитыЭпизода"]=previous.map{v in ["дата":NativeTreatments.field(v,1),"запись":NativeTreatments.field(v,5),"назначения":Self.drugs(NativeTreatments.field(v,0),p).map(Self.rx)] as JournalObject}}
        let exams=entries(p,"exams").filter{caption($0,"visit")==visit}
        if !exams.isEmpty {data["обследования"]=exams.map{e in ["дата":caption(e,"date"),"вид":caption(e,"method"),"область":caption(e,"region"),"описание":caption(e,"description"),"заключение":caption(e,"conclusion"),"параметры":entries(e,"parameters").map{r in ["название":caption(r,"name"),"значение":caption(r,"value"),"единица":caption(r,"unit")]}] as JournalObject}}
        var alternatives=[String]()
        for med in drugs {
            let key=NativePharmacy.key(visit,med),sig=try call("marketPrescriptionKey",[med]).toString()
            if let criteria=entries(p,"marketCriteria").first(where:{caption($0,"id")==key && caption($0,"prescription")==sig}), !caption(criteria,"alternative").isEmpty {alternatives.append(caption(criteria,"alternative"))}
        }
        data["вариантыВрача"]=alternatives
        guard let cleaned=try call("cleanSnapshot",[data]).toDictionary() as? JournalObject else {throw JournalError("Не удалось обезличить данные.")}
        return cleaned
    }
}

@MainActor
enum NativeTreatmentDelivery {
    struct Request {
        let snapshot:JournalObject
        let version:Int
        var text:String
    }

    static func allowsAutomatic(_ journal:DeviceJournal,owner:String)->Bool {
        guard journal.editable,journal.profile(owner)["chatGPTAuto"] as? Bool==true else {return false}
        let actor=NativePromptLibrary.actor(journal)
        guard owner==actor || journal.admin && journal.members.contains(where:{
            caption($0,"id")==owner && caption($0,"role")=="Ребёнок"
        }) else {return false}
        return !journal.conflicts(owner).contains{ row in
            let path=row["path"] as? [Any] ?? []
            return caption(row,"lane")=="consent" && (path.isEmpty || path.first as? String=="chatGPTAuto")
        }
    }

    static func prepare(_ journal:DeviceJournal,owner:String,visit:String)throws->Request {
        let profile=journal.profile(owner),rules=try TreatmentRules.make(profile,members:journal.members)
        let snapshot=try rules.payload(visit,profile)
        guard let template=NativePromptLibrary.templates(journal).first(where:{caption($0,"id")=="treatment"}) else {
            throw JournalError("Шаблон разбора лечения недоступен.")
        }
        let version=template["version"] as? Int ?? 1
        let prompt=try rules.call("buildTreatmentPrompt",[template,snapshot]).toString() ?? ""
        let previous=(profile["prompts"] as? [String:JournalObject])?[visit] ?? [:]
        let matches=(previous["snapshot"] as? String).flatMap{try? jsonObject(Data($0.utf8))}.map{
            ($0 as NSDictionary).isEqual(to:snapshot)
        } ?? false
        let saved=matches && previous["templateVersion"] as? Int==version ? caption(previous,"text"): ""
        return .init(snapshot:snapshot,version:version,text:saved.isEmpty ? prompt : saved)
    }

    static func send(_ journal:DeviceJournal,owner:String,visit:String,request:Request,automatic:Bool,via transport:NativeChatGPTTransport) async throws {
        guard journal.editable,!automatic || transport.providerName == "ChatGPT" && allowsAutomatic(journal,owner:owner) else {
            throw JournalError("Отправка для этого профиля требует подтверждения.")
        }
        let job=owner+"/"+visit
        guard journal.runningTreatmentReviews.insert(job).inserted else {throw JournalError("Разбор уже выполняется.")}
        defer {journal.runningTreatmentReviews.remove(job)}
        try await waitForExchange(journal)
        let current=try prepare(journal,owner:owner,visit:visit)
        let rules=try TreatmentRules.make(journal.profile(owner),members:journal.members)
        let exact=try rules.clean(request.text.trim)
        guard !exact.isEmpty,exact==request.text.trim,
              current.version==request.version,(current.snapshot as NSDictionary).isEqual(to:request.snapshot) else {
            throw JournalError("Сведения изменились. Проверьте запрос и подтвердите отправку снова.")
        }
        if automatic && !allowsAutomatic(journal,owner:owner) {throw JournalError("Автоотправка для этого профиля выключена.")}
        let snapshot=String(decoding:try jsonBytes(request.snapshot),as:UTF8.self)
        try journal.changeProfile(owner){p in
            var prompts=p["prompts"] as? [String:JournalObject] ?? [:]
            prompts[visit]=["snapshot":snapshot,"text":exact,"templateVersion":request.version,"transfers":entries(prompts[visit] ?? [:],"transfers")]
            p["prompts"]=prompts
            let queued=entries(p,"treatmentQueue")
            if !queued.contains(where:{caption($0,"id")==visit}){
                p["treatmentQueue"]=queued+[["id":visit,"time":ISO8601DateFormatter().string(from:Date())]]
            }
        }
        var transfer=NativeChatGPTConversation.transfer(journal)
        if automatic {transfer["automatic"]=true}
        let reply=try await transport.reply([ChatGPTMessage(role:.user,content:exact)])
        guard !reply.answer.trim.isEmpty,!reply.model.trim.isEmpty else {
            throw JournalError("Провайдер не вернул завершённый ответ. Запрос сохранён.")
        }
        try await waitForExchange(journal)
        try journal.changeProfile(owner){p in
            var prompts=p["prompts"] as? [String:JournalObject] ?? [:]
            guard NativeTreatments.visits(p).contains(where:{NativeTreatments.field($0,0)==visit}),
                  let saved=prompts[visit],caption(saved,"snapshot")==snapshot,caption(saved,"text")==exact else {
                throw JournalError("Карточка или черновик изменились во время разбора.")
            }
            var review:JournalObject=[
                "id":UUID().uuidString,"kind":"provider","provider":transport.providerName+" · "+reply.model,
                "time":ISO8601DateFormatter().string(from:Date()),"visit":visit,
                "prompt":exact,"answer":reply.answer,"payload":request.snapshot,"templateVersion":request.version,
                "transfers":entries(saved,"transfers")+[transfer]
            ]
            review["items"]=try rules.items(review)
            p["reviews"]=entries(p,"reviews")+[review]
            p["treatmentQueue"]=entries(p,"treatmentQueue").filter{caption($0,"id") != visit}
            prompts.removeValue(forKey:visit);p["prompts"]=prompts
        }
    }

    private static func waitForExchange(_ journal:DeviceJournal)async throws {
        for _ in 0..<120 {
            if !journal.busy {return}
            try await Task.sleep(for:.milliseconds(250))
        }
        throw JournalError("Дождитесь обмена. Запрос сохранён.")
    }
}

struct NativeTreatmentReview:View {
    @ObservedObject var journal:DeviceJournal
    @Environment(\.nativeAPIKeys) private var keys
    let owner:String,visit:String
    @State private var composing=false
    var body:some View {
        let p=journal.profile(owner), meds=TreatmentRules.drugs(visit,p)
        let history=entries(p,"reviews").filter{caption($0,"visit")==visit}.sorted{caption($0,"time")>caption($1,"time")}
        List {
            Section("Исходное назначение врача"){
                if meds.isEmpty {Text("Назначенные препараты пока не внесены.")}
                ForEach(meds.indices,id:\.self){i in
                    let m=meds[i]
                    VStack(alignment:.leading){Text(caption(m,"name")).bold();Text([caption(m,"strength"),caption(m,"form"),caption(m,"instructions")].filter{!$0.isEmpty}.joined(separator:" · "))
                        NavigationLink("Аналоги и цены"){NativePharmacy(journal:journal,owner:owner,visit:visit,med:m)}}
                }
            }
            NativeDoctorLink(journal:journal,owner:owner,visit:visit)
            if journal.editable {Button(keys?.connected.isEmpty == false ? "Разобрать лечение" : "Разобрать лечение в ChatGPT"){composing=true}.disabled(meds.isEmpty || journal.busy)}
            Section("История разборов"){
                if history.isEmpty {Text("Разборов пока нет.").foregroundStyle(.secondary)}
                ForEach(history.indices,id:\.self){i in NavigationLink{NativeReviewVersion(journal:journal,owner:owner,id:caption(history[i],"id"))}label:{VStack(alignment:.leading){Text(i==0 ? "Последний разбор":"Предыдущий разбор");Text(caption(history[i],"time")).font(.caption)}}}
            }
        }.journalBackground().navigationTitle("Разбор лечения").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented:$composing){NavigationStack{NativeReviewComposer(journal:journal,owner:owner,visit:visit)}}
    }
}

private struct NativeReviewComposer:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,visit:String
    @Environment(\.dismiss) var dismiss
    @Environment(\.nativeChatGPT) private var chatGPT
    @Environment(\.nativeAPIKeys) private var keys
    @State private var provider:NativeAIProvider?
    @State private var directRequest:NativeTreatmentDelivery.Request?
    @State private var sending=false
    @State private var text=""
    @State private var answer=""
    @State private var error=""
    @State private var notice=""
    @State private var payload:JournalObject=[:]
    @State private var draftID=""
    @State private var copied=false
    @State private var confirm=false
    @State private var openChatAfterCopy=false
    @State private var browserFallback=false
    @State private var validation=JournalFormValidation()
    @State private var checkedAnswer=false
    var body:some View {
        let promptIssue=JournalFieldIssue.required("review-exact",text,"Введите текст запроса.")
        let answerIssue=JournalFieldIssue.required("review-answer",answer,"Вставьте ответ на запрос.")
        let visible=validation.visible([copied ? nil : promptIssue,checkedAnswer ? answerIssue : nil].compactMap{$0})
        Form {
            if !payload.isEmpty {
                Section("Точный запрос"){
                    if copied {DisclosureGroup("Показать скопированный текст"){Text(text).textSelection(.enabled)}}
                    else {TextEditor(text:$text).frame(minHeight:170).accessibilityIdentifier("review-exact-prompt").journalField("review-exact",visible)}
                    if let directRequest, !copied {
                        Text("Проверьте обезличенные сведения перед отправкой.").font(.caption)
                        NativeProviderChoice(preferred:"",choice:$provider) { transport in
                            if let transport {
                                let title = transport.providerName == "ChatGPT" ? "Подтвердить и отправить" : "Подтвердить и отправить в " + transport.providerName
                                Button(sending ? "Ожидаем разбор…" : title){
                                    if validation.submit([promptIssue].compactMap{$0}) {send(directRequest,via:transport)}
                                }.disabled(journal.busy || sending)
                            } else {
                                NavigationLink("Подключить API-ключ"){NativeChatGPTSettings(account:nil)}
                            }
                        }.disabled(sending)
                    } else {
                        Text("Проверьте обезличенные сведения перед копированием. Оригиналы вложений остаются в дневнике.").font(.caption)
                        Button("Скопировать и открыть новый чат", systemImage: "arrow.up.right.square"){
                            guard validation.submit([promptIssue].compactMap{$0}) else{return}
                            openChatAfterCopy=true;confirm=true
                        }.disabled(journal.busy)
                        Button(copied ? "Скопировать снова":"Скопировать запрос"){
                            guard validation.submit([promptIssue].compactMap{$0}) else{return}
                            openChatAfterCopy=false;confirm=true
                        }.disabled(journal.busy)
                        if browserFallback {Link("Открыть веб-версию ChatGPT",destination:ChatGPTHandoff.website)}
                    }
                }
                if directRequest==nil || copied {Section("Ответ ChatGPT"){
                    TextField("Вставьте ответ на скопированный запрос",text:$answer,axis:.vertical).accessibilityIdentifier("review-pasted-answer")
                        .journalField("review-answer",visible)
                    Button("Сохранить версию разбора"){
                        checkedAnswer=true
                        if validation.submit([answerIssue].compactMap{$0}) {act{try persist(isAnswer:true);dismiss()}}
                    }.disabled(!copied || journal.busy)
                }}
            }
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
            if !notice.isEmpty {Text(notice).foregroundStyle(.secondary)}
        }.journalValidation(validation).navigationTitle(directRequest == nil ? "Ручной разбор" : "Разбор лечения").toolbar{
            ToolbarItem(placement:.cancellationAction){Button("Закрыть"){dismiss()}.disabled(sending)}
        }.interactiveDismissDisabled(sending)
        .onAppear{act{try load()}}
        .confirmationDialog("Подтвердите передачу запроса",isPresented:$confirm,titleVisibility:.visible){
            Button(openChatAfterCopy ? "Подтвердить и открыть ChatGPT" : "Подтвердить и скопировать"){
                act {
                    try persist(isAnswer:false)
                    if openChatAfterCopy {
                        notice="Запрос скопирован. В новом чате выберите «Вставить»."
                        Task {
                            browserFallback = !(await ChatGPTHandoff.openNewChat())
                            if browserFallback {notice="Запрос скопирован. Если приложение ChatGPT недоступно, откройте веб-версию."}
                        }
                    }
                }
            }
        } message:{Text("Проверьте содержание запроса для этого профиля. Ваше имя и время копирования сохранятся в истории передачи.")}
    }
    private func send(_ saved:NativeTreatmentDelivery.Request,via transport:NativeChatGPTTransport){
        act {
            let clean=try TreatmentRules.make(journal.profile(owner),members:journal.members).clean(text.trim)
            if clean != text.trim {
                text=clean
                throw JournalError("Личные сведения скрыты. Проверьте текст и подтвердите отправку.")
            }
            var request=saved;request.text=clean;sending=true
            Task {
                defer {sending=false}
                do {
                    try await NativeTreatmentDelivery.send(journal,owner:owner,visit:visit,request:request,automatic:false,via:transport)
                    dismiss()
                } catch {self.error=error.localizedDescription + (transport.providerName == "ChatGPT" ? "" : " Запрос сохранён.")}
            }
        }
    }
    func act(_ operation:()throws->Void){do{error="";try operation()}catch{self.error=error.localizedDescription}}
    func load()throws {
        let p=journal.profile(owner)
        if let draft=(p["prompts"] as? [String:JournalObject])?[visit], !caption(draft,"nativeID").isEmpty, let saved=draft["payload"] as? JournalObject {
            payload=saved;text=caption(draft,"text");draftID=caption(draft,"nativeID");copied=true;return
        }
        if chatGPT != nil || keys?.connected.isEmpty == false {
            let request=try NativeTreatmentDelivery.prepare(journal,owner:owner,visit:visit)
            directRequest=request;payload=request.snapshot;text=request.text;return
        }
        let rules=try TreatmentRules.make(p,members:journal.members)
        let snapshot=try rules.payload(visit,p)
        guard let template=NativePromptLibrary.templates(journal).first(where:{caption($0,"id")=="treatment"}) ?? NativePromptLibrary.defaults.first else {throw JournalError("Шаблон разбора лечения недоступен.")}
        text=try rules.call("buildTreatmentPrompt",[template,snapshot]).toString()
        payload=snapshot;draftID=UUID().uuidString
    }
    func persist(isAnswer:Bool)throws {
        let now=ISO8601DateFormatter().string(from:Date()),actor=NativePromptLibrary.actor(journal)
        let by=journal.members.first{caption($0,"id")==actor}.map{caption($0,"name")} ?? ""
        guard !actor.isEmpty,!by.isEmpty else {throw JournalError("Не удалось определить автора действия.")}
        let transfer:JournalObject=["id":UUID().uuidString,"time":now,"role":journal.admin ? "admin":"adult","actorId":actor,"actorName":by,"kind":isAnswer ? "answer":"copy"]
        let rules=try TreatmentRules.make(journal.profile(owner),members:journal.members)
        var exact=text
        if copied, !isAnswer, try rules.clean(exact) != exact {
            throw JournalError("В сохранённом тексте обнаружены личные сведения.")
        }
        if !copied {
            exact=try rules.clean(text.trim)
            guard !exact.isEmpty else {throw JournalError("Запрос пуст.")}
            if exact != text {text=exact;throw JournalError("Удалены личные сведения. Ещё раз проверьте текст запроса.")}
        }
        try journal.changeProfile(owner){p in
            var drafts=p["prompts"] as? [String:JournalObject] ?? [:]
            let prior=drafts[visit] ?? [:]
            if copied {
                guard caption(prior,"nativeID")==draftID,caption(prior,"text")==exact,let previous=prior["payload"] as? NSDictionary,previous.isEqual(to:payload) else {throw JournalError("Запрос изменился на другом устройстве. Откройте разбор заново.")}
            }else {
                guard caption(prior,"nativeID").isEmpty else {throw JournalError("На другом устройстве уже подготовлен запрос. Откройте разбор заново.")}
                let current=try rules.payload(visit,p)
                guard (current as NSDictionary).isEqual(to:payload) else {try load();throw JournalError("Карта изменилась. Проверьте обновлённый запрос.")}
            }
            let transfers=(copied ? entries(prior,"transfers"):[]) + [transfer]
            if isAnswer {
                guard copied,!answer.trim.isEmpty else {throw JournalError("Сначала скопируйте запрос и добавьте ответ.")}
                var review:JournalObject=["id":UUID().uuidString,"kind":"manual","time":now,"visit":visit,"prompt":exact,"answer":answer.trim,"payload":payload,"transfers":transfers]
                review["items"]=try rules.items(review)
                p["reviews"]=entries(p,"reviews")+[review]
                p["treatmentQueue"]=entries(p,"treatmentQueue").filter{caption($0,"id") != visit}
                drafts.removeValue(forKey:visit)
            }else {drafts[visit]=["nativeID":draftID,"text":exact,"payload":payload,"transfers":transfers]}
            p["prompts"]=drafts
        }
        if !isAnswer {ChatGPTHandoff.copy(exact);copied=true;notice="Запрос скопирован."}
    }
}

private struct NativeReviewVersion:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,id:String
    @State private var error=""
    var body:some View {
        let r=entries(journal.profile(owner),"reviews").first{caption($0,"id")==id} ?? [:],p=r["payload"] as? JournalObject ?? [:]
        let result=Result{try TreatmentRules().items(r)}, meds=entries(p,"назначения")
        List {
            Section("Разбор по препаратам"){
                switch result {
                case let .failure(problem):Text(problem.localizedDescription)
                case let .success(items):
                    ForEach(items.indices,id:\.self){i in
                        let item=items[i],drug=meds.indices.contains(i) ? meds[i]:[:]
                        VStack(alignment:.leading,spacing:5){
                            Text([caption(drug,"название"),caption(drug,"дозировка")].joined(separator:" ")).bold()
                            Text(caption(item,"label"));Text(caption(item,"reason")).font(.subheadline)
                            if let c=item["candidate"] as? JournalObject {
                                Text([caption(c,"section"),caption(c,"sourceDisease"),caption(c,"sourceAge")].filter{!$0.isEmpty}.joined(separator:" · ")).font(.caption)
                                if let u=URL(string:caption(c,"source")),u.scheme=="https"{Link("Открыть раздел источника",destination:u)}
                                if item["canVerify"] as? Bool==true, journal.editable {
                                    Text("Предложенная категория: "+caption(c,"claim")).font(.caption)
                                    Button("Подтверждаю применимость раздела к препарату, диагнозу и возрасту"){
                                        do {try verify(i,c)}catch{self.error=error.localizedDescription}
                                    }.disabled(journal.busy)
                                }
                            }
                            if !caption(item,"verifiedBy").isEmpty {Text(caption(item,"verifiedBy")+" · "+caption(item,"verifiedAt")).font(.caption)}
                        }
                    }
                }
            }
            Section("История передачи"){ForEach(entries(r,"transfers").indices,id:\.self){i in let e=entries(r,"transfers")[i];Text([caption(e,"kind")=="copy" ? "Скопировано":caption(e,"kind")=="answer" ? "Ответ добавлен":"Отправлено",caption(e,"actorName"),caption(e,"time")].joined(separator:" · "))}}
            DisclosureGroup("Точный запрос"){Text(caption(r,"prompt")).textSelection(.enabled)}
            DisclosureGroup("Исходный ответ"){Text(caption(r,"answer")).textSelection(.enabled)}
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
        }.navigationTitle("Версия разбора")
    }
    func verify(_ index:Int,_ candidate:JournalObject)throws {
        let rules=try TreatmentRules()
        try journal.changeProfile(owner){profile in
            var rows=entries(profile,"reviews")
            guard let n=rows.firstIndex(where:{caption($0,"id")==id}) else {throw JournalError("Версия разбора недоступна.")}
            let row=rows[n],items=try rules.items(row)
            guard items.indices.contains(index),items[index]["canVerify"] as? Bool==true,let current=items[index]["candidate"] as? NSDictionary,current.isEqual(to:candidate) else {throw JournalError("Оценка изменилась. Сверьте источник повторно.")}
            let p=row["payload"] as? JournalObject ?? [:],patient=p["пациент"] as? JournalObject ?? [:]
            let actor=NativePromptLibrary.actor(journal)
            let check:JournalObject=["index":index,"source":caption(candidate,"source"),"label":caption(candidate,"claim"),"section":caption(candidate,"section"),"diagnosis":caption(p,"эпизод"),"age":caption(patient,"Возраст на дату визита"),"by":journal.members.first{caption($0,"id")==actor}.map{caption($0,"name")} ?? actor,"at":ISO8601DateFormatter().string(from:Date())]
            rows[n]["sourceChecks"]=entries(row,"sourceChecks").filter{$0["index"] as? Int != index}+[check]
            profile["reviews"]=rows
        }
    }
}

struct NativePharmacy:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,visit:String,med:JournalObject
    @State private var criteria:[String:String]=[:]
    @State private var status=""
    @State private var error=""
    @State private var busy=false
    @State private var results=[JournalObject]()
    @State private var marketRows=[JournalObject]()
    @State private var lastSearch:JournalObject?
    @State private var disclosed=Set<String>()
    @State private var generation=UUID()
    @State private var criteriaValidation=JournalFormValidation()
    @State private var checkingSearch=false
    static let regions=["Минск":"1001","Брест":"41","Гродно":"38","Витебск":"19"]
    static let labels=[("trade","Торговое название"),("substance","Действующее вещество / МНН"),("form","Лекарственная форма"),("pack","Размер упаковки"),("route","Путь введения"),("release","Тип высвобождения"),("alternative","Отдельный вариант от врача")]
    static func key(_ visit:String,_ med:JournalObject)->String {
        visit+"/"+(caption(med,"id").isEmpty ? NativeTreatments.signature(med):caption(med,"id"))
    }
    static func link(_ path:String,_ query:String,_ value:String,region:String)->URL? {
        var u=URLComponents();u.scheme="https";u.host="tabletka.by";u.path=path
        u.queryItems=[URLQueryItem(name:query,value:value)] + (region=="0" ? []:[URLQueryItem(name:"region",value:region)]);return u.url
    }
    static func parse(_ data:Data,region:String,rules:TreatmentRules,now:Date=Date())throws->JournalObject {
        guard let obj=try JSONSerialization.jsonObject(with:data) as? JournalObject,caption(obj,"region")==region,let packages=obj["packages"] as? [JournalObject] else {throw JournalError("Каталог прислал неподтверждённые данные.")}
        let fmt=ISO8601DateFormatter();fmt.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let raw=caption(obj,"checked")
        guard let date=fmt.date(from:raw) ?? ISO8601DateFormatter().date(from:raw),abs(date.timeIntervalSince(now))<=1800 else {throw JournalError("Время проверки каталога устарело.")}
        for item in packages {guard try rules.call("validCatalogPackage",[item]).toBool() else {throw JournalError("Не удалось подтвердить упаковку и цену.")}}
        return obj
    }
    var city:String {journal.data["city"] as? String ?? "Минск"}
    var body:some View {
        let region=Self.regions[city]
        let visible=visibleCriteriaIssues
        Form {
            Section("Назначение врача"){Text([caption(med,"name"),caption(med,"strength"),caption(med,"form")].filter{!$0.isEmpty}.joined(separator:" · "))}
            Section("Параметры сравнения"){
                ForEach(Self.labels.indices,id:\.self){i in let (key,label)=Self.labels[i]
                    TextField(label,text:Binding(get:{criteria[key] ?? ""},set:{criteria[key]=$0;clear()}))
                        .disabled(!journal.editable || (key=="form" && !caption(med,"form").isEmpty))
                        .journalField("pharmacy-"+key,visible)
                }
                if journal.editable {
                    Button("Сохранить данные поиска"){
                        do {
                            let rules=try TreatmentRules.make(journal.profile(owner),members:journal.members)
                            checkingSearch=false
                            if criteriaValidation.submit(try criteriaIssues(rules)){try save()}
                        }catch{self.error=error.localizedDescription}
                    }.disabled(journal.busy)
                }
                Text("Для сравнения нужны МНН, дозировка, форма, путь введения и тип высвобождения. Для цены назначенной упаковки укажите её размер.").font(.caption)
            }
            Section("Поиск в аптеках"){
                Text("В каталог передаются название или МНН и регион.").font(.caption)
                if let region {Button(lastSearch==nil ? "Проверить цены · "+city : "Повторить поиск · "+city){Task{await search(region)}}}
                Button("Искать по всей Беларуси"){Task{await search("0")}}
                if let url=directLink(region ?? "0") {Link("Искать на tabletka.by",destination:url)}
                if let url=directLink(region ?? "0",alternative:true) {Link("Искать отдельный вариант врача",destination:url)}
            }.disabled(busy)
            if busy {ProgressView("Проверяем цены…")}
            if !status.isEmpty {Text(status)}
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
            if !results.isEmpty {resultsSection}
        }.journalValidation(criteriaValidation).navigationTitle("Аналоги и цены").onAppear{do{try load()}catch{self.error=error.localizedDescription}}
        .onDisappear{generation=UUID()}
    }
    private var visibleCriteriaIssues:[JournalFieldIssue] {
        guard criteriaValidation.attempt>0,let rules=try? TreatmentRules.make(journal.profile(owner),members:journal.members) else{return []}
        return (try? criteriaIssues(rules,forSearch:checkingSearch)) ?? []
    }
    @ViewBuilder private var resultsSection:some View {
        ForEach(["exact","analogue","otherPack","unverified","different"],id:\.self){group in
            let rows=results.filter{caption($0,"group")==group}
            if !rows.isEmpty {
                Section(["exact":"Назначенная упаковка","analogue":"Совпадают состав и характеристики","otherPack":"Другие упаковки этого препарата","unverified":"Требуют сверки","different":"Отличаются от назначения"][group] ?? group){
                    ForEach(rows.indices,id:\.self){i in
                        let r=rows[i],id=caption(r,"id")
                        VStack(alignment:.leading,spacing:4){
                            Text(caption(r,"name")).bold();Text([caption(r,"form"),caption(r,"substance"),caption(r,"manufacturer")].filter{!$0.isEmpty}.joined(separator:" · "))
                            Text(caption(r,"why")).font(.caption)
                            let automaticPrice=["exact","analogue","otherPack"].contains(group)
                            if !automaticPrice && !disclosed.contains(id),group=="unverified",
                               (r["pharmacyCount"] as? Int ?? 0)>0,let facts=r["facts"] as? JournalObject,
                               ["strength","form","pack"].allSatisfy({!caption(facts,$0).isEmpty}) {
                                Button("Посмотреть цену этой упаковки"){disclosed.insert(id)}
                            }
                            let offers=entries(r,"offers")
                            ForEach(offers.indices,id:\.self){index in
                                let offer=offers[index],region=caption(offer,"region")
                                if automaticPrice || disclosed.contains(id) {
                                    Text(String(format:"%.2f – %.2f BYN",offer["min"] as? Double ?? 0,offer["max"] as? Double ?? 0))
                                }
                                Text(marketPlace(region)+" · "+caption(offer,"checked")).font(.caption)
                                if let u=Self.link("/result/","ls",id,region:region){Link("Наличие на tabletka.by",destination:u)}
                            }
                        }
                    }
                }
            }
        }
    }
    func clear(){generation=UUID();busy=false;disclosed=[];status="";error=""}
    private func marketPlace(_ region:String)->String {
        region=="0" ? "Вся Беларусь" : Self.regions.first{$0.value==region}?.key ?? "Регион поиска"
    }
    private func decoded(_ value:Any?)->JournalObject? {
        guard let text=value as? String else{return nil}
        return try? jsonObject(Data(text.utf8))
    }
    private func marketID(_ rules:TreatmentRules)throws->(String,String) {
        (Self.key(visit,med),try rules.call("marketPrescriptionKey",[med]).toString())
    }
    private func refreshResults(_ rules:TreatmentRules)throws {
        let observations=marketRows.compactMap{decoded($0["observation"])}.filter{
            !$0.isEmpty && (try? rules.call("validCatalogPackage",[$0]).toBool())==true
        }
        results=try Dictionary(grouping:observations){caption($0,"id")}.values.compactMap { rows in
            let offers=rows.sorted{caption($0,"checked")>caption($1,"checked")}
            guard var first=offers.first else{return nil}
            let match=try rules.call("packageAssessment",[first,med,criteria]).toDictionary() as? JournalObject ?? [:]
            first.merge(match){_,new in new};first["offers"]=offers
            return first
        }.sorted{caption($0,"id")<caption($1,"id")}
    }
    func load()throws {
        let p=journal.profile(owner),rules=try TreatmentRules.make(p,members:journal.members)
        let facts=try rules.call("marketDescription",[caption(med,"form")]).toDictionary() as? JournalObject ?? [:]
        let (key,sig)=try marketID(rules)
        let stored=entries(p,"marketCriteria").first{caption($0,"id")==key && caption($0,"prescription")==sig}
        criteria=["trade":caption(med,"name"),"form":caption(med,"form"),"pack":caption(med,"pack"),"route":caption(facts,"route"),"release":caption(facts,"release")]
        if let stored {for (key,_) in Self.labels {criteria[key]=caption(stored,key)}}
        lastSearch=decoded(stored?["lastSearch"])
        marketRows=entries(p,"marketFindings").filter{caption($0,"criteriaId")==key && caption($0,"prescription")==sig}
        if let lastSearch {
            let earlier=try rules.call("marketFindingRows",[lastSearch,key,visit,sig]).toArray() as? [JournalObject] ?? []
            marketRows=try rules.call("mergeMarketFindings",[marketRows,earlier]).toArray() as? [JournalObject] ?? marketRows
            status=marketPlace(caption(lastSearch,"region"))+" · "+caption(lastSearch,"checked")
        }
        try refreshResults(rules)
    }
    private func criteriaIssues(_ rules:TreatmentRules,forSearch:Bool=false)throws->[JournalFieldIssue] {
        let c=criteria.mapValues{$0.trim}
        let facts=try rules.call("marketDescription",[caption(med,"form")]).toDictionary() as? JournalObject ?? [:]
        return try Self.labels.compactMap { key,_ in
            let field="pharmacy-"+key,value=c[key] ?? ""
            let prescribed=caption(facts,key)
            if ["route","release"].contains(key),!prescribed.isEmpty,c[key] != prescribed {
                return JournalFieldIssue(field:field,message:"Сверьте это поле с исходным назначением врача.")
            }
            if !value.isEmpty {
                if let issue=JournalFieldIssue.length(field,value,limit:90) {return issue}
                if try rules.clean(value) != value {
                    return JournalFieldIssue(field:field,message:"Уберите личные сведения из этого поля.")
                }
            }
            if ["trade","substance","alternative"].contains(key) {
                let query=key=="trade" && value.isEmpty && forSearch ? caption(med,"name") : value
                if key=="trade",forSearch,query.isEmpty,(c["substance"] ?? "").isEmpty {
                    return JournalFieldIssue(field:field,message:"Укажите торговое название или МНН.")
                }
                if !query.isEmpty {
                    let safe=try rules.call("safeMarketQuery",[query]).toString() ?? ""
                    if safe.isEmpty || (forSearch && key != "alternative" && safe != query) {
                        return JournalFieldIssue(field:field,message:"Уточните название для поиска.")
                    }
                }
            }
            return nil
        }
    }
    func verified(_ rules:TreatmentRules)throws->[String:String] {
        if let issue=try criteriaIssues(rules).first {throw JournalError(issue.message)}
        return criteria.mapValues{$0.trim}
    }
    func directLink(_ region:String,alternative:Bool=false)->URL? {
        guard let rules=try? TreatmentRules.make(journal.profile(owner),members:journal.members),let c=try? verified(rules) else{return nil}
        let trade=c["trade"]?.isEmpty==false ? c["trade"]! : caption(med,"name")
        let q=alternative ? c["alternative"] ?? "" : [trade,caption(med,"strength"),c["form"] ?? "",c["pack"] ?? ""].filter{!$0.isEmpty}.joined(separator:" ")
        guard !q.isEmpty,(try? rules.clean(q))==q,alternative || (try? rules.call("safeMarketQuery",[trade]).toString())==trade else{return nil}
        return Self.link("/search/","request",q,region:region)
    }
    func save()throws {
        let rules=try TreatmentRules.make(journal.profile(owner),members:journal.members)
        try store(rules, criteria: verified(rules), search:lastSearch)
        try refreshResults(rules)
        status="Параметры поиска сохранены."
    }
    private func store(_ rules:TreatmentRules, criteria values:[String:String], search:JournalObject?, newRows:[JournalObject]=[])throws {
        let (key,sig)=try marketID(rules)
        var c=values
        c["prescription"]=sig;c["visit"]=visit;c["id"]=key
        if let search {c["lastSearch"]=try String(decoding:jsonBytes(search),as:UTF8.self)}
        try journal.changeProfile(owner){p in
            p["marketCriteria"]=entries(p,"marketCriteria").filter{caption($0,"id") != key}+[c]
            if !newRows.isEmpty {
                p["marketFindings"]=try rules.call("mergeMarketFindings",[entries(p,"marketFindings"),newRows]).toArray() as? [JournalObject] ?? entries(p,"marketFindings")
            }
        }
    }
    @MainActor func search(_ region:String)async {
        clear();let token=generation;busy=true
        defer{if generation==token {busy=false}}
        do {
            let rules=try TreatmentRules.make(journal.profile(owner),members:journal.members)
            checkingSearch=true
            guard criteriaValidation.submit(try criteriaIssues(rules,forSearch:true)) else{return}
            var c=criteria.mapValues{$0.trim}
            let names=Set([c["trade"]?.isEmpty==false ? c["trade"]! : caption(med,"name"),c["substance"] ?? ""].filter{!$0.isEmpty})
            let session=DeviceExchange().session;defer{session.finishTasksAndInvalidate()}
            var skus=[String:JournalObject](),times=[String](),partial=false
            for name in names.sorted(){
                do {
                    var req=URLRequest(url:DeviceExchange.cloud.appendingPathComponent("pharmacy/search"));req.httpMethod="POST";req.timeoutInterval=15;req.setValue("application/json",forHTTPHeaderField:"Content-Type")
                    req.httpBody=try JSONSerialization.data(withJSONObject:["name":name,"region":region])
                    let (bytes,response)=try await session.data(for:req)
                    guard (response as? HTTPURLResponse)?.statusCode==200 else {throw JournalError("Каталог временно недоступен.")}
                    let ans=try Self.parse(bytes,region:region,rules:rules);times.append(caption(ans,"checked"));partial=partial || ans["partial"] as? Bool==true
                    for package in entries(ans,"packages"){skus[caption(package,"id")]=package}
                } catch {partial=true}
                if token != generation {return}
            }
            guard let first=times.sorted().first else {throw JournalError("Сейчас подтвердить цены не удалось. Доступен поиск на tabletka.by.")}
            let packages=Array(skus.values.sorted{caption($0,"id")<caption($1,"id")}.prefix(80))
            if (c["substance"] ?? "").isEmpty,let substance=try rules.call("catalogSubstance",[packages,med,c]).toString(),!substance.isEmpty {
                c["substance"]=substance;criteria["substance"]=substance
            }
            let search:JournalObject=["region":region,"checked":first,"packages":packages,
                                      "packageCount":skus.count,"partial":partial,"limited":skus.count>packages.count]
            let (key,sig)=try marketID(rules)
            let rows=try rules.call("marketFindingRows",[search,key,visit,sig]).toArray() as? [JournalObject] ?? []
            if journal.editable {try store(rules,criteria:c,search:search,newRows:rows)}
            marketRows=try rules.call("mergeMarketFindings",[marketRows,rows]).toArray() as? [JournalObject] ?? marketRows
            lastSearch=search
            try refreshResults(rules)
            status=marketPlace(region)+" · "+first+(partial ? "\nКаталог вернул неполные сведения.":"")+(skus.isEmpty ? "\nПодтверждённых предложений нет.":"")
        }catch {if token==generation{self.error=error.localizedDescription}}
    }
}
