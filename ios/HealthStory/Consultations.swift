import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ConsultationSource: Identifiable {
    let id: String, kind: String, recordID: String, label: String, details: String
    let clinical: [String]
    var tags: [String] = []
    var children: [String] = []
    var reference: JournalObject { ["kind":kind,"id":recordID,"label":label] }
}

struct ConsultationDraft {
    static let risk = ["id":"risk-factors","name":"Оценка факторов риска","text":"Разбери факторы риска для указанного заболевания и периода. Если подходящая валидированная шкала или исходные данные отсутствуют, перечисли недостающие сведения. Назови источники и ограничения.","version":1] as JournalObject

    static func sources(_ profile: JournalObject, tags: [JournalObject]) -> [ConsultationSource] {
        var list = [ConsultationSource]()
        let doctors = entries(profile,"addedDoctors"), files = entries(profile,"files")
        let recordTags=RecordTags(profile:profile,library:tags)
        func tagged(_ source:ConsultationSource) -> ConsultationSource {
            var s=source
            s.tags=recordTags.names(s.id)
            return s
        }
        var profileData=[String]()
        for f in entries(profile,"fields") {
            let fields=["height":"Рост","weight":"Вес","allergy":"Аллергии","chronic":"Хронические заболевания"]
            let value=caption(f,"value")
            if let label=fields[caption(f,"id")], !value.trim.isEmpty {profileData.append(label+" · "+value)}
            if caption(f,"id")=="birthday" {
                let fmt=DateFormatter();fmt.locale=Locale(identifier:"en_US_POSIX");fmt.dateFormat="yyyy-MM-dd"
                if let birth=fmt.date(from:value),let years=Calendar.current.dateComponents([.year],from:birth,to:Date()).year,years>=0 {profileData.append("Возраст · "+String(years))}
            }
        }
        if !profileData.isEmpty {list.append(.init(id:"profile",kind:"medical",recordID:"",label:"Медкарта",details:"Возраст, рост, вес, аллергии и хронические заболевания",clinical:profileData))}
        let visits=(profile["addedVisits"] as? [[Any]] ?? []).filter{$0.count>=8}
        for exam in entries(profile,"exams") {
            let id=caption(exam,"id")
            let fields=["date","method","region","description","conclusion"].map{caption(exam,$0)}.filter{!$0.isEmpty}
            let parameters=entries(exam,"parameters").map{r in ["name","value","unit"].map{caption(r,$0)}.filter{!$0.isEmpty}.joined(separator:" ")}
            list.append(tagged(.init(id:"exam:"+id,kind:"exam",recordID:id,label:nativeExamTitle(exam),details:fields.prefix(3).joined(separator:" · "),clinical:["Обследование"]+fields+parameters)))
        }
        for v in visits {
            guard let id=v[0] as? String else {continue}
            let date=v[1] as? String ?? "", title=v[2] as? String ?? ""
            let info=doctors.first{caption($0,"id")==v[3] as? String}?["values"] as? [String] ?? []
            let specialty=info.count>1 ? info[1] : ""
            var text=[date,v[4] as? String ?? "",specialty,v[5] as? String ?? ""]
            let meds=v.count>8 ? (v[8] as? [JournalObject] ?? []) : []
            text += meds.map{ row in ["name","form","strength","instructions"].map{caption(row,$0)}.filter{!$0.isEmpty}.joined(separator:" · ")}
            text += entries(profile,"recommendations").filter{caption($0,"visit")==id}.map{caption($0,"text")}
            text += entries(profile,"notes").filter{caption($0,"visit")==id}.map{caption($0,"text")}
            text += files.filter{ caption($0,"visit")==id && $0["intake"] as? Bool==true && $0["checked"] as? Bool==true }.flatMap { f in
                [caption(f,"context")] + entries(f,"meds").map{m in ["name","form","strength","instructions"].map{caption(m,$0)}.filter{!$0.isEmpty}.joined(separator:" · ")}
            }
            var source=tagged(ConsultationSource(id:"visit:"+id,kind:"visit",recordID:id,label:title,details:date+" · "+specialty,clinical:["Визит"]+text.filter{!$0.trim.isEmpty}))
            source.children=entries(profile,"exams").filter{caption($0,"visit")==id}.map{"exam:"+caption($0,"id")}
            list.append(source)
        }
        for f in files {
            let id=caption(f,"id")
            if let lab=f["lab"] as? JournalObject {
                var name=caption(lab,"name")
                if name==caption(f,"name") || name==URL(fileURLWithPath:caption(f,"name")).deletingPathExtension().lastPathComponent {name="Лабораторное исследование"}
                let rows=entries(lab,"rows")
                let text=rows.map{ r in ["name","value","unit","specimen","range"].map{caption(r,$0)}.filter{!$0.isEmpty}.joined(separator:" · ") }
                list.append(tagged(.init(id:"lab:"+id,kind:"lab",recordID:id,label:name,details:caption(lab,"date")+" · "+rows.map{caption($0,"name")}.joined(separator:", "),clinical:["Анализ",name,caption(lab,"date")]+text)))
            } else if caption(f,"category")=="Заключения", !caption(f,"clinicalText").trim.isEmpty {
                list.append(tagged(.init(id:"file:"+id,kind:"file",recordID:id,label:"Заключение",details:caption(f,"date"),clinical:["Сверенное заключение",caption(f,"clinicalText")])))
            }
        }
        for prevention in entries(profile,"prevention") {
            let id=caption(prevention,"id"),title=caption(prevention,"title")
            let text=[title,caption(prevention,"kind"),caption(prevention,"period"),caption(prevention,"next"),caption(prevention,"note")]
                + entries(prevention,"history").map{[caption($0,"date"),caption($0,"note")].joined(separator:" ")}
            list.append(tagged(.init(id:"prevent:"+id,kind:"prevent",recordID:id,label:title,details:"Профилактика · "+caption(prevention,"next"),clinical:text.filter{!$0.isEmpty})))
        }
        for episode in entries(profile,"episodes") {
            let id=caption(episode,"id")
            let visitIDs=visits.filter{$0[7] as? String==id}.compactMap{$0[0] as? String}
            let ids=Set(visitIDs)
            var children=visitIDs.map{"visit:"+$0}
            children += files.filter{ids.contains(caption($0,"visit"))}.flatMap{f in ["lab:"+caption(f,"id"),"file:"+caption(f,"id")]}
            children += entries(profile,"exams").filter{ids.contains(caption($0,"visit"))}.map{"exam:"+caption($0,"id")}
            let available=list.filter{children.contains($0.id)}
            var context=["Эпизод",caption(episode,"name")]
            context += entries(profile,"measurements").filter{caption($0,"episode")==id}.map{m in ["time","name","value","unit"].map{caption(m,$0)}.filter{!$0.isEmpty}.joined(separator:" · ")}
            context += entries(profile,"questions").filter{caption($0,"episode")==id}.map{caption($0,"text")}
            var source=ConsultationSource(id:"episode:"+id,kind:"episode",recordID:id,label:caption(episode,"name"),details:"Визиты и связанные заключения и анализы",clinical:context)
            source.children=available.map(\.id)
            source.tags=Array(Set(available.flatMap(\.tags))).sorted()
            list.append(source)
        }
        return list
    }

    static func knownNames(members:[JournalObject],profile:JournalObject) -> [String] {
        members.map{caption($0,"name")} + entries(profile,"addedDoctors").compactMap{($0["values"] as? [String])?.first} + entries(profile,"exams").flatMap{[caption($0,"doctor"),caption($0,"clinic")].filter{!$0.isEmpty}}
    }

    static func build(question:String,template:JournalObject,sources:[ConsultationSource],selected:Set<String>,names:[String],parser:ClinicalImport) throws -> JournalObject {
        let direct=sources.filter{selected.contains($0.id)}
        let expanded=selected.union(direct.flatMap(\.children))
        let records=sources.filter{expanded.contains($0.id)}
        let question=try parser.redact(question.trim,names:names)
        let instruction=try parser.redact(caption(template,"text"),names:names)
        var parts=[instruction,question].filter{!$0.isEmpty}
        for record in records {
            let text=try record.clinical.map{try parser.redact($0,names:names)}.joined(separator:"\n")
            if !text.isEmpty {parts.append(text)}
        }
        guard !question.isEmpty || !instruction.isEmpty else {throw JournalError("Введите вопрос для консультации.")}
        return ["id":UUID().uuidString,"time":ISO8601DateFormatter().string(from:Date()),"question":question.isEmpty ? caption(template,"name") : question,
                "template":template,"refs":records.map(\.reference),"sources":direct.map(\.id),"prompt":parts.joined(separator:"\n\n"),"answer":"","provider":""]
    }
}

struct Consultations:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var new=false
    var body:some View {
        let history=Array(entries(journal.profile(owner),"consultations").reversed())
        List {
            if journal.editable {Button("Новая консультация",systemImage:"plus"){new=true}}
            if journal.editable {NavigationLink("Промпты и согласие"){NativePromptSettings(journal:journal,owner:owner)}}
            Section("История профиля"){
                if history.isEmpty {Text("Консультаций пока нет.").foregroundStyle(.secondary)}
                ForEach(history.indices,id:\.self){i in
                    let row=history[i]
                    NavigationLink {ConsultationRecord(journal:journal,owner:owner,id:caption(row,"id"))}
                        label:{VStack(alignment:.leading){Text(caption(row,"question"));Text(caption(row,"time")+" · "+(caption(row,"answer").isEmpty ? "Ожидает ответа":"Ответ сохранён")).font(.caption)}}
                }
            }
        }.journalBackground().navigationTitle("ИИ-консультация").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented:$new){NavigationStack{ConsultationComposer(journal:journal,owner:owner)}}
    }
}

private struct ConsultationComposer:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    @Environment(\.dismiss) var dismiss
    @State private var question=""
    @State private var templateID=""
    @State private var search=""
    @State private var tag=""
    @State private var error=""
    @State private var selected=Set<String>()
    @State private var prepared: String?
    @State private var validation=JournalFormValidation()
    var body:some View {
        let profile=journal.profile(owner)
        let all=ConsultationDraft.sources(profile,tags:entries(journal.data,"tags"))
        let templates=NativePromptLibrary.templates(journal)
        let template=templates.first{caption($0,"id")==templateID} ?? ["id":"","name":"Свой запрос","text":"","version":1] as JournalObject
        let issues=(templateID.isEmpty || templateID=="risk-factors") ?
            [JournalFieldIssue.required("consultation-question",question,"Введите вопрос для консультации.")].compactMap{$0} : []
        Form {
            Section("Вопрос"){
                Picker("Шаблон",selection:$templateID){Text("Свой запрос").tag("");ForEach(templates.indices,id:\.self){i in Text(caption(templates[i],"name")).tag(caption(templates[i],"id"))}}
                if !caption(template,"text").isEmpty {DisclosureGroup("Инструкция"){Text(caption(template,"text"))}}
                TextField("Что нужно разобрать?",text:$question,axis:.vertical)
                    .journalField("consultation-question",validation.visible(issues))
            }
            Section("Данные профиля · выбрано "+String(selected.count)){
                TextField("Найти визит, анализ или тег",text:$search)
                Picker("Тег",selection:$tag){Text("Все теги").tag("");ForEach(Array(Set(all.flatMap(\.tags))).sorted(),id:\.self){Text($0).tag($0)}}
                ForEach(all.filter{s in (tag.isEmpty || s.tags.contains(tag)) && (search.isEmpty || ([s.label,s.details]+s.tags).joined(separator:" ").localizedCaseInsensitiveContains(search))}){s in
                    Toggle(isOn:Binding(get:{selected.contains(s.id)},set:{if $0{selected.insert(s.id)}else{selected.remove(s.id)}})){
                        VStack(alignment:.leading){Text(s.label);Text(([s.details]+s.tags).joined(separator:" · ")).font(.caption).foregroundStyle(.secondary)}
                    }
                }
            }
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
            Button("Проверить запрос") {
                guard validation.submit(issues) else{return}
                do {
                    let names=ConsultationDraft.knownNames(members:journal.members,profile:profile)
                    let row=try ConsultationDraft.build(question:question,template:template,sources:all,selected:selected,names:names,parser:ClinicalImport())
                    try journal.changeProfile(owner){p in p["consultations"]=entries(p,"consultations")+[row]}
                    prepared=caption(row,"id")
                } catch {self.error=error.localizedDescription}
            }.disabled(!journal.editable || journal.busy)
        }.journalValidation(validation).journalBackground().navigationTitle("Новая консультация")
            .navigationDestination(item:$prepared){id in ConsultationRecord(journal:journal,owner:owner,id:id)}
        .toolbar{ToolbarItem(placement:.cancellationAction){Button("Закрыть"){dismiss()}}}
    }
}

private struct ConsultationRecord:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,id:String
    @Environment(\.nativeChatGPT) private var chatGPT
    @State private var answer=""
    @State private var error=""
    @State private var notice=""
    @State private var preview=""
    @State private var followup=""
    @State private var ready=false
    @State private var sending=false
    @State private var browserFallback=false
    @State private var exportingRequest=false
    @State private var requestFile: ChatGPTRequestFile?
    @State private var outboundHistory: [ChatGPTMessage]?
    @State private var received: (ChatGPTReply,String,[ChatGPTMessage],[ChatGPTMessage],JournalObject)?
    @State private var validation=JournalFormValidation()
    @State private var checkedAnswer=false
    private var requestIssue:JournalFieldIssue? {.required("consultation-request",preview,"Введите текст запроса.")}
    private var followupIssue:JournalFieldIssue? {.required("consultation-followup",followup,"Введите следующий вопрос.")}
    private var answerIssue:JournalFieldIssue? {.required("consultation-answer",answer,"Вставьте ответ провайдера.")}

    private func checkAnswer(_ confirmed:Bool) -> Bool {
        checkedAnswer=true
        return validation.submit([confirmed ? nil : requestIssue,answerIssue].compactMap{$0})
    }
    var body:some View {
        let row=entries(journal.profile(owner),"consultations").first{caption($0,"id")==id} ?? [:]
        let saved=caption(row,"answer")
        let previous=NativeChatGPTConversation.history(row)
        let confirmed = !caption(row,"sentAt").isEmpty || !caption(row,"copiedAt").isEmpty || !saved.isEmpty
        let issues=validation.visible([confirmed ? nil : requestIssue,saved.isEmpty ? nil : followupIssue,checkedAnswer ? answerIssue : nil].compactMap{$0})
        Form {
            Section("Точный запрос"){
                if confirmed {Text(caption(row,"prompt")).textSelection(.enabled)}
                else if ready && journal.editable {
                    TextEditor(text:$preview).frame(minHeight:140).accessibilityLabel("Текст запроса")
                        .journalField("consultation-request",issues).disabled(received != nil)
                }
                else if ready {Text(preview).textSelection(.enabled)}
            }
            let history=entries(row,"transfers")
            if !history.isEmpty {Section("История передачи"){ForEach(history.indices,id:\.self){i in
                let t=history[i],kind=caption(t,"kind")
                Text([kind=="copy" ? "Скопировано для ручной передачи":kind=="answer" ? "Ответ добавлен":"Отправлено провайдеру",caption(t,"actorName"),caption(t,"time")].joined(separator:" · "))
            }}}
            if !saved.isEmpty {
                Section("Сохранённый ответ"){Text(saved).textSelection(.enabled);Text(caption(row,"provider")).font(.caption)}
                let turns=entries(row,"turns")
                ForEach(turns.indices,id:\.self){i in
                    let turn=turns[i]
                    Section(caption(turn,"question")){
                        Text(caption(turn,"answer")).textSelection(.enabled)
                        Text([caption(turn,"provider"),caption(turn,"time")].joined(separator:" · ")).font(.caption)
                        if turn["sentHistory"] != nil {
                            DisclosureGroup("Отправленный контекст"){
                                ForEach(Array(entries(turn,"sentHistory").enumerated()),id:\.offset){ _, message in
                                    Text(caption(message,"content")).textSelection(.enabled)
                                }
                            }
                        }
                        ForEach(entries(turn,"transfers").indices,id:\.self){j in
                            Text(caption(entries(turn,"transfers")[j],"actorName")).font(.caption)
                        }
                    }
                }
                if journal.editable {
                    Section("Продолжение переписки"){
                        TextField("Следующий вопрос",text:$followup,axis:.vertical)
                            .accessibilityIdentifier("chatgpt-followup-draft")
                            .journalField("consultation-followup",issues).disabled(received != nil)
                        DisclosureGroup("Текст предыдущих сообщений, который будет отправлен"){
                            ForEach(Array((outboundHistory ?? []).enumerated()),id:\.offset){ _, message in
                                Text((message.role == .user ? "Вы" : "Ответ") + "\n" + message.content).textSelection(.enabled)
                            }
                            if outboundHistory == nil { Text("Контекст недоступен для отправки.") }
                        }
                        providerAction(row,continuation:true)
                    }
                }
            }
            else if journal.editable {
                Section("Личный ChatGPT"){providerAction(row,continuation:false)}
                Section("Ручная передача"){
                    if journal.admin,let family=journal.data["family"] as? JournalObject,caption(family,"adminId") != owner,journal.members.first(where:{caption($0,"id")==owner})?["role"] as? String=="Взрослый" {
                        Text("Разовая передача из профиля другого взрослого. Отправитель и время сохранятся в истории.")
                    }
                    Text("Выбранные данные включены в проверенный текст. В новом чате выберите «Вставить» или добавьте сохранённый TXT.")
                    Group {
                        Button("Скопировать и открыть новый чат", systemImage: "arrow.up.right.square") {
                            if validation.submit([confirmed ? nil : requestIssue].compactMap{$0}) {copyPrompt(openChat:true)}
                        }
                        Button(caption(row,"copiedAt").isEmpty ? "Скопировать запрос":"Скопировать снова") {
                            if validation.submit([confirmed ? nil : requestIssue].compactMap{$0}) {copyPrompt(openChat:false)}
                        }
                        Button("Сохранить запрос как TXT", systemImage: "doc.text") {
                            guard validation.submit([confirmed ? nil : requestIssue].compactMap{$0}) else{return}
                            error = ""
                            do {
                                requestFile = try ChatGPTRequestFile(checkedManualPrompt(row))
                                exportingRequest = true
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(!ready || journal.busy)
                    if browserFallback {
                        Link("Открыть веб-версию ChatGPT", destination: ChatGPTHandoff.website)
                    }
                }
                Section("Ответ провайдера"){
                    TextField("Вставьте ответ",text:$answer,axis:.vertical).journalField("consultation-answer",issues)
                    Button("Сохранить ответ"){
                        guard checkAnswer(confirmed) else{return}
                        do {_=try update(answer:answer.trim)}catch{self.error=error.localizedDescription}
                    }.disabled(!ready || journal.busy)
                }
            }
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
            if !notice.isEmpty {Text(notice).foregroundStyle(.secondary)}
        }.journalValidation(validation).journalBackground().navigationTitle("Запрос и ответ")
            .disabled(sending)
            .navigationBarBackButtonHidden(sending || received != nil)
            .fileExporter(isPresented: $exportingRequest, document: requestFile, contentType: .plainText, defaultFilename: "chatgpt-request.txt") { result in
                requestFile = nil
                switch result {
                case .success: notice = "TXT сохранён. В ChatGPT добавьте его через «+»."
                case .failure(let error): self.error = error.localizedDescription
                }
            }
            .task(id:previous) {
                outboundHistory=try? cleanHistory(previous)
            }
            .task(id:id) {
            do {
                preview=confirmed ? caption(row,"prompt") : try clean(caption(row,"prompt"))
                followup=caption(row,"nextQuestion")
                ready=true
            }
            catch {self.error=error.localizedDescription;ready=false}
        }
    }
    @ViewBuilder private func providerAction(_ row: JournalObject, continuation: Bool) -> some View {
        if sending {
            ProgressView("Ожидаем ответ ChatGPT…")
        } else if received != nil {
            Button("Сохранить полученный ответ"){ persistReply() }
                .disabled(journal.busy)
            Button("Выйти без сохранения ответа",role:.destructive){ received = nil }
        } else if let chatGPT {
            if journal.admin, owner != NativePromptLibrary.actor(journal),
               journal.members.first(where:{caption($0,"id")==owner})?["role"] as? String=="Взрослый" {
                Text("Разовая отправка из профиля другого взрослого. Отправитель и время сохранятся в истории.")
            }
            Button("Подтвердить и отправить в ChatGPT"){
                if validation.submit([continuation ? followupIssue : requestIssue].compactMap{$0}) {
                    send(row,continuation:continuation,via:chatGPT)
                }
            }.disabled(!ready || journal.busy || (continuation && outboundHistory == nil))
        } else {
            Text("Прямое подключение ChatGPT на iPhone ожидает допуска OpenAI.").font(.footnote)
            if continuation {
                Button("Сохранить черновик"){
                    if caption(row,"nextQuestion").isEmpty && !validation.submit([followupIssue].compactMap{$0}) {return}
                    do {
                        try NativeChatGPTConversation.edit(journal,owner:owner,id:id){$0["nextQuestion"]=followup.trim}
                        error=""
                        notice="Черновик сохранён."
                    } catch {notice="";self.error=error.localizedDescription}
                }.disabled(!ready || journal.busy)
            }
        }
    }
    private func send(_ row: JournalObject, continuation: Bool, via transport: NativeChatGPTTransport) {
        guard journal.editable, !sending, received == nil else { return }
        error=""
        notice=""
        do {
            let typed = continuation ? followup.trim : preview.trim
            let exact = try clean(typed)
            guard !exact.isEmpty else { throw JournalError("Проверьте текст запроса.") }
            let history = NativeChatGPTConversation.history(row)
            let locked = !caption(row,"sentAt").isEmpty || !caption(row,"copiedAt").isEmpty
            if exact != typed {
                if locked && !continuation { throw JournalError("В запросе есть личные сведения. Создайте новую консультацию.") }
                if continuation { followup=exact } else { preview=exact }
                error="Личные сведения скрыты. Проверьте изменённый текст и подтвердите отправку."
                return
            }
            let sentHistory=try cleanHistory(history)
            if continuation && outboundHistory != sentHistory {
                outboundHistory=sentHistory
                error="Контекст обновился. Проверьте предыдущие сообщения и подтвердите отправку."
                return
            }
            let messages = sentHistory + [ChatGPTMessage(role:.user,content:exact)]
            try NativeChatGPTConversation.edit(journal,owner:owner,id:id){ current in
                guard NativeChatGPTConversation.history(current) == history,
                      (continuation || !locked || caption(current,"prompt") == exact) else {
                    throw JournalError("Консультация изменилась. Откройте историю.")
                }
                current[continuation ? "nextQuestion" : "prompt"] = exact
            }
            let transfer = NativeChatGPTConversation.transfer(journal)
            sending=true
            Task {
                defer { sending=false }
                do {
                    let reply = try await transport.reply(messages)
                    guard !reply.answer.trim.isEmpty, !reply.model.trim.isEmpty else {
                        throw JournalError("ChatGPT не вернул завершённый ответ. Вопрос сохранён.")
                    }
                    received=(reply,exact,history,sentHistory,transfer)
                    persistReply()
                } catch { self.error=error.localizedDescription }
            }
        } catch { self.error=error.localizedDescription }
    }
    private func persistReply() {
        guard let (reply,question,previous,sentHistory,transfer)=received else { return }
        do {
            try NativeChatGPTConversation.edit(journal,owner:owner,id:id){
                try NativeChatGPTConversation.save(reply,question:question,previous:previous,sentHistory:sentHistory,transfer:transfer,in:&$0)
            }
            received=nil
            followup=""
            error=""
        } catch {self.error=error.localizedDescription}
    }
    private func clean(_ value:String) throws -> String {
        let message=ChatGPTMessage(role:.user,content:value)
        return try cleanHistory([message])[0].content
    }
    private func cleanHistory(_ messages: [ChatGPTMessage]) throws -> [ChatGPTMessage] {
        guard !messages.isEmpty else { return [] }
        let parser=try ClinicalImport(), profile=journal.profile(owner)
        let names=ConsultationDraft.knownNames(members:journal.members,profile:profile)
        var clinics=entries(profile,"exams").map{caption($0,"clinic")}
        clinics += NativeTreatments.visits(profile).map{NativeTreatments.field($0,9)}
        clinics += entries(profile,"addedDoctors").compactMap{($0["values"] as? [String])?.dropFirst(2).first}
        clinics += entries(profile,"visitDrafts").compactMap{($0["header"] as? JournalObject).map{caption($0,"clinic")}}
        clinics += entries(profile,"files").compactMap{($0["lab"] as? JournalObject).map{caption($0,"laboratory")}}
        let files=(entries(profile,"files")+entries(profile,"visitDrafts")).map{caption($0,"name")}
        return try messages.map{
            try ChatGPTMessage(role:$0.role,content:parser.redact($0.content,names:names,clinics:clinics,files:files))
        }
    }
    private func checkedManualPrompt(_ row: JournalObject) throws -> String {
        let locked = !caption(row, "sentAt").isEmpty || !caption(row, "copiedAt").isEmpty
        let draft = locked ? caption(row, "prompt") : preview.trim
        guard !draft.isEmpty else { throw JournalError("Проверьте текст запроса.") }
        let checked = try clean(draft)
        if checked != draft {
            if locked { throw JournalError("В сохранённом тексте обнаружены личные сведения. Подготовьте новую консультацию.") }
            preview = checked
            throw JournalError("Личные сведения скрыты. Проверьте обновлённый текст и повторите действие.")
        }
        return checked
    }

    private func copyPrompt(openChat: Bool) {
        error = ""
        notice = ""
        do {
            ChatGPTHandoff.copy(try update(answer: nil))
            notice = openChat ? "Запрос скопирован. В новом чате выберите «Вставить»." : "Запрос скопирован."
            if openChat {
                Task {
                    browserFallback = !(await ChatGPTHandoff.openNewChat())
                    if browserFallback { notice = "Запрос скопирован. Если приложение ChatGPT недоступно, откройте веб-версию." }
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    private func update(answer:String?) throws -> String {
        var exact=""
        try journal.changeProfile(owner){p in
            var rows=entries(p,"consultations")
            guard let i=rows.firstIndex(where:{caption($0,"id")==id}),caption(rows[i],"answer").isEmpty else {throw JournalError("Консультация изменилась. Откройте историю.")}
            let row=rows[i]
            let sent = !caption(row,"sentAt").isEmpty || !caption(row,"copiedAt").isEmpty
            if answer == nil { exact = try checkedManualPrompt(row) }
            else { exact = sent ? caption(row,"prompt") : try clean(preview.trim) }
            guard !exact.isEmpty else {throw JournalError("Проверьте текст запроса.")}
            rows[i]["prompt"]=exact
            let now=ISO8601DateFormatter().string(from:Date())
            let family=journal.data["family"] as? JournalObject ?? [:]
            let actorID=journal.admin ? caption(family,"adminId"):caption(journal.access,"member")
            let actor=journal.members.first{caption($0,"id")==actorID} ?? [:]
            let transfer:JournalObject=["id":UUID().uuidString,"role":journal.admin ? "admin":"adult","actorId":actorID,"actorName":caption(actor,"name"),"time":now,"kind":answer==nil ? "copy":"answer"]
            rows[i]["transfers"]=entries(row,"transfers")+[transfer]
            if let answer {rows[i]["answer"]=answer;rows[i]["provider"]="Ручной перенос";rows[i]["answeredAt"]=now}
            else if caption(row,"copiedAt").isEmpty {rows[i]["copiedAt"]=now;if !sent {rows[i]["sentAt"]=now}; rows[i]["provider"]="Ручной перенос"}
            p["consultations"]=rows
        }
        return exact
    }
}
