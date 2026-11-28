import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

func nativeExamTitle(_ record:JournalObject) -> String {
    ["method","region"].map{caption(record,$0)}.filter{!$0.isEmpty}.joined(separator:" · ")
}
struct ExamLinks:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,rows:[JournalObject]
    var body:some View {
        ForEach(rows.sorted{caption($0,"date")>caption($1,"date")}.map{caption($0,"id")},id:\.self){id in
            if let row=rows.first(where:{caption($0,"id")==id}){
                NavigationLink { NativeExamDetail(journal:journal,owner:owner,id:id) } label:{
                    VStack(alignment:.leading){Text(nativeExamTitle(row));Text(caption(row,"date")).font(.caption)}
                }
            }
        }
    }
}
struct NativeExams:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var query=""
    @State private var new=false
    var body:some View {
        let p=journal.profile(owner)
        let tags=RecordTags(profile:p,library:entries(journal.data,"tags"))
        List {
            if journal.editable {
                Button("Добавить обследование",systemImage:"plus"){new=true}
                let drafts=entries(p,"examDrafts")
                if !drafts.isEmpty {Section("Продолжить сверку"){
                    ForEach(drafts.indices,id:\.self){i in
                        let row=drafts[i],title=nativeExamTitle(row["fields"] as? JournalObject ?? [:])
                        NavigationLink(title.isEmpty ? "Черновик обследования":title){NativeExamEditor(journal:journal,owner:owner,draft:row)}
                    }
                }}
            }
            Section("Сохранённые обследования"){
                ExamLinks(journal:journal,owner:owner,rows:entries(p,"exams").filter{e in
                    let words=[nativeExamTitle(e),caption(e,"date"),caption(e,"conclusion")]+entries(e,"parameters").map{caption($0,"name")}
                    return tags.matches(query,key:"exam:"+caption(e,"id"),fields:words)
                })
            }
        }.journalBackground().navigationTitle("Результаты обследований").navigationBarTitleDisplayMode(.inline)
            .searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Вид, область, параметр или тег")
        .navigationDestination(isPresented:$new){NativeExamEditor(journal:journal,owner:owner)}
    }
}
struct NativeExamDetail:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,id:String
    var body:some View {
        let p=journal.profile(owner),e=entries(p,"exams").first{caption($0,"id")==id} ?? [:]
        let ids=Set(entries(e,"attachments").map{caption($0,"id")})
        List {
            Section {Text(nativeExamTitle(e));Text([caption(e,"date"),caption(e,"doctor"),caption(e,"clinic")].filter{!$0.isEmpty}.joined(separator:" · "))}
            let rows=entries(e,"parameters")
            if !rows.isEmpty {Section("Параметры"){ForEach(rows.indices,id:\.self){i in
                LabeledContent(caption(rows[i],"name"),value:[caption(rows[i],"value"),caption(rows[i],"unit")].joined(separator:" "))
            }}}
            if !caption(e,"description").isEmpty {Section("Описание"){Text(caption(e,"description"))}}
            Section("Заключение врача"){Text(caption(e,"conclusion").isEmpty ? "Заключение пока не добавлено.":caption(e,"conclusion"))}
            NativeRecordTags(journal:journal,owner:owner,kind:.exam,id:id)
            Section("Протокол и снимки"){NativeFiles(journal:journal,owner:owner,items:entries(p,"files").filter{ids.contains(caption($0,"id"))})}
            if journal.editable {NavigationLink("Редактировать"){NativeExamEditor(journal:journal,owner:owner,exam:e,draft:entries(p,"examDrafts").first{caption($0,"exam")==id} ?? [:])}}
        }.journalBackground().navigationTitle("Обследование").navigationBarTitleDisplayMode(.inline)
    }
}
private struct ExamMeasurement:Equatable,Identifiable {
    var id=UUID().uuidString,name="",value="",unit=""
    init(_ row:JournalObject=[:]) {
        if let key=row["id"] as? String {id=key}
        name=caption(row,"name");value=caption(row,"value");unit=caption(row,"unit")
    }
    var json:JournalObject {["id":id,"name":name,"value":value,"unit":unit]}
}
private struct NativeExamEditor:View {
    @State private var duplicate:DuplicateClinicalCard?
    @ObservedObject var journal:DeviceJournal
    let owner:String,recordID:String
    @Environment(\.dismiss) private var dismiss
    @State private var fields:[String:String]
    @State private var draftID:String
    @State private var dateDefault:Bool
    @State private var sourcePosition:NativeSourcePosition
    @State private var rows:[ExamMeasurement]
    @State private var sources:[JournalObject]
    @State private var reviewed:Bool
    @State private var picking=false
    @State private var pickingExisting=false
    @State private var protocolMode=true
    @State private var reading=false
    @State private var finished=false
    @State private var notice=""
    @State private var showCamera=false
    @State private var photos:[PhotosPickerItem]=[]
    @State private var validation=JournalFormValidation()
    private let keys=["method","customMethod","region","date","doctor","clinic","visit","description","conclusion"]
    private let methods=["УЗИ","Рентгенография","Флюорография","КТ","МРТ","ЭКГ","Эндоскопия"]
    init(journal:DeviceJournal,owner:String,exam:JournalObject=[:],draft:JournalObject=[:]){
        self.journal=journal;self.owner=owner
        let originalID=caption(draft,"exam")
        let base=exam.isEmpty ? entries(journal.profile(owner),"exams").first{caption($0,"id")==originalID} ?? [:]:exam
        recordID=caption(base,"id")
        _draftID=State(initialValue:draft["id"] as? String ?? UUID().uuidString)
        let input=draft["fields"] as? JournalObject ?? base
        let date=caption(input,"date")
        var initialFields=Dictionary(uniqueKeysWithValues:keys.map{($0,caption(input,$0))})
        initialFields["date"]=date.isEmpty ? dayString():date
        _fields=State(initialValue:initialFields)
        _sourcePosition=State(initialValue:NativeSourcePosition(draft["position"] as? JournalObject ?? [:]))
        _dateDefault=State(initialValue:date.isEmpty || draft["dateDefault"] as? Bool==true)
        _rows=State(initialValue:(draft.isEmpty ? entries(base,"parameters"):entries(draft,"parameters")).map(ExamMeasurement.init))
        _sources=State(initialValue:entries(draft,"sources"));_reviewed=State(initialValue:draft["reviewed"] as? Bool ?? false)
    }
    private func binding(_ key:String)->Binding<String>{Binding(get:{fields[key] ?? ""},set:{fields[key]=$0})}
    private var hasProtocol:Bool {sources.contains{$0["protocol"] as? Bool==true}}
    private var existingFiles:[JournalObject] {
        let profile=journal.profile(owner),exam=entries(profile,"exams").first{caption($0,"id")==recordID} ?? [:]
        let linked=Set((entries(exam,"attachments")+sources).map{caption($0,"id")})
        return entries(profile,"files").filter{file in
            guard file["examDraft"]==nil,!linked.contains(caption(file,"id")) else {return false}
            let mime=caption(file,"type"),ext=URL(fileURLWithPath:caption(file,"name")).pathExtension
            let type=UTType(mimeType:mime) ?? UTType(filenameExtension:ext)
            return type.map{$0.conforms(to:.image) || $0.conforms(to:.pdf) || $0.conforms(to:protocolMode ? .plainText : .zip)} ?? false
        }
    }
    private func parameterField(_ row:ExamMeasurement,_ key:String)->String {"exam-\(row.id)-\(key)"}
    private var validationIssues:[JournalFieldIssue] {
        let date=fields["date"] ?? ""
        let record=entries(journal.profile(owner),"exams").first{caption($0,"id")==recordID} ?? [:]
        let missingResult=sources.isEmpty && entries(record,"attachments").isEmpty && rows.isEmpty &&
            (fields["description"] ?? "").trim.isEmpty && (fields["conclusion"] ?? "").trim.isEmpty
        var issues=[JournalFieldIssue.required("exam-method",fields["method"] ?? "","Укажите вид обследования."),
            !date.trim.isEmpty && CoursePeriod.date(date)==nil ?
                JournalFieldIssue(field:"exam-date",message:"Введите дату в формате ГГГГ-ММ-ДД.") : nil].compactMap{$0}
        for row in rows {
            issues += [
                .required(parameterField(row,"name"),row.name,"Введите название параметра."),
                .required(parameterField(row,"value"),row.value,"Введите значение параметра.")
            ].compactMap{$0}
        }
        if missingResult {issues.append(JournalFieldIssue(field:"exam-description",message:"Добавьте описание, заключение, параметр или вложение."))}
        if hasProtocol && !reviewed {issues.append(JournalFieldIssue(field:"exam-review",message:"Подтвердите сверку с протоколом."))}
        return issues
    }
    var body:some View {
        let visits=(journal.profile(owner)["addedVisits"] as? [[Any]] ?? []).filter{$0.count>=8}
        let visible=validation.visible(validationIssues)
        let profile=journal.profile(owner)
        let current=entries(profile,"exams").first{caption($0,"id")==recordID} ?? [:]
        let savedIDs=Set(entries(current,"attachments").map{caption($0,"id")})
        let saved=entries(profile,"files").filter{savedIDs.contains(caption($0,"id"))}
        let preview=(saved+sources).map{NativeSourceItem(id:caption($0,"id"),name:caption($0,"name"))}
        NativeSourceReview(sources:preview,position:$sourcePosition,load:{try await journal.attachment(owner:owner,id:$0)}) {
        Form {
            Section("Оригиналы"){
                Picker("Что добавить",selection:$protocolMode){Text("Протокол").tag(true);Text("Снимок").tag(false)}.pickerStyle(.segmented)
                Button("Из файлов"){picking=true}
                if !existingFiles.isEmpty {Button("Из документов профиля"){pickingExisting=true}}
                PhotosPicker("Из фото",selection:$photos,matching:.images)
                if UIImagePickerController.isSourceTypeAvailable(.camera){Button("Снять камерой"){showCamera=true}}
                ForEach(sources.indices,id:\.self){i in
                    let src=sources[i]
                    NavigationLink(caption(src,"name")){DeviceAttachment(journal:journal,owner:owner,id:caption(src,"id"),name:caption(src,"name"))}
                    if !caption(src,"note").isEmpty {Text(caption(src,"note")).foregroundStyle(.secondary)}
                    if src["protocol"] as? Bool==true {Button("Распознать · "+caption(src,"name")){Task{await recognize(caption(src,"id"))}}}
                }
            }.disabled(reading||journal.busy)
            Section("Обследование"){
                Picker("Вид обследования",selection:Binding(get:{
                    let value=fields["method"] ?? ""
                    return value.isEmpty || methods.contains(value) ? value:"Другое"
                },set:{fields["method"]=$0})) {
                    Text("Выберите вид").tag("")
                    ForEach(methods,id:\.self){Text($0).tag($0)}
                    Text("Другое").tag("Другое")
                }.journalField("exam-method",visible)
                if let method=fields["method"],!method.isEmpty,!methods.contains(method) {
                    TextField("Название вида обследования",text:Binding(
                        get:{fields["method"]=="Другое" ? "":fields["method"] ?? ""},
                        set:{fields["method"]=$0.isEmpty ? "Другое":$0}))
                }
                TextField("Область исследования",text:binding("region"))
                JournalCalendarField(title:"Дата обследования",day:Binding(
                    get:{fields["date"] ?? ""},
                    set:{dateDefault=$0.trim.isEmpty;fields["date"]=$0}
                )).journalField("exam-date",visible)
                if dateDefault {Text("По умолчанию используется сегодняшняя дата. Её можно изменить.").font(.caption).foregroundStyle(.secondary)}
                TextField("Клиника",text:binding("clinic"));TextField("Врач",text:binding("doctor"))
                Picker("Визит",selection:binding("visit")){Text("Без привязки").tag("");ForEach(visits.indices,id:\.self){i in Text([visits[i][1],visits[i][2]].compactMap{$0 as? String}.joined(separator:" · ")).tag(visits[i][0] as? String ?? "")}}
            }
            Section("Параметры"){
                ForEach($rows){$r in VStack(alignment:.leading){
                    TextField("Название",text:$r.name).journalField(parameterField(r,"name"),visible)
                    TextField("Значение",text:$r.value).journalField(parameterField(r,"value"),visible)
                    TextField("Единица",text:$r.unit)
                }}.onDelete{rows.remove(atOffsets:$0)}
                Button("Добавить параметр"){rows.append(ExamMeasurement())}
            }
            Section("Результаты"){
                TextField("Описание",text:binding("description"),axis:.vertical).journalField("exam-description",visible)
                TextField("Заключение врача",text:binding("conclusion"),axis:.vertical)
                if hasProtocol {Toggle("Сведения сверены с протоколом",isOn:$reviewed).journalField("exam-review",visible)}
            }
            if !notice.isEmpty {Text(notice)}
            if let duplicate {NavigationLink("Открыть существующее обследование"){NativeExamDetail(journal:journal,owner:owner,id:duplicate.id)}}
            Button("Сохранить обследование"){save(final:true)}.disabled(reading||journal.busy)
            Button("Отложить сверку"){if save(){dismiss()}}.disabled(reading||journal.busy)
        }.journalValidation(validation)
        }.journalBackground().navigationTitle("Сверка обследования")
        .fileImporter(isPresented:$picking,allowedContentTypes:protocolMode ? [.image,.pdf,.plainText]:[.image,.pdf,.zip],allowsMultipleSelection:true){result in
            Task{do{for url in try result.get(){let data=try readNativeFile(url);try await add(data,url.lastPathComponent,UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")}}catch{notice=error.localizedDescription}}
        }
        .sheet(isPresented:$pickingExisting){
            NavigationStack {
                List {
                    ForEach(existingFiles.indices,id:\.self){index in
                        let file=existingFiles[index]
                        Button(caption(file,"name")){
                            pickingExisting=false
                            Task{await attachExisting(file)}
                        }
                    }
                }.navigationTitle(protocolMode ? "Выбрать протокол" : "Выбрать снимок")
                    .toolbar{Button("Отмена"){pickingExisting=false}}
            }
        }
        .sheet(isPresented:$showCamera){NativeCamera{data in Task{do{try await add(data,"Фото.jpg","image/jpeg")}catch{notice=error.localizedDescription}}}}
        .onChange(of:photos){_,items in Task{do{for item in items{if let data=try await item.loadTransferable(type:Data.self){let type=item.supportedContentTypes.first;try await add(data,"Фото."+(type?.preferredFilenameExtension ?? "jpg"),type?.preferredMIMEType ?? "image/jpeg")}}}catch{notice=error.localizedDescription}}}
        .onChange(of:fields){_,_ in save()}.onChange(of:rows){_,_ in save()}.onChange(of:reviewed){_,_ in save()}
        .task(id:sourcePosition){
            guard !sourcePosition.sourceID.isEmpty else {return}
            do {try await Task.sleep(for:.milliseconds(300))}catch{return}
            let saved=entries(journal.profile(owner),"examDrafts").first{caption($0,"id")==draftID}?["position"] as? JournalObject
            if saved==nil || NativeSourcePosition(saved ?? [:]) != sourcePosition {_=save()}
        }
    }
    @discardableResult private func save(final:Bool=false,newFile:NativeUpload?=nil)->Bool {
        if finished{return true}
        if final && !validation.submit(validationIssues) {return false}
        do{
            var args=fields
            if final && (args["date"] ?? "").trim.isEmpty {args["date"]=dayString()}
            let parameters=rows.map(\.json),newID=recordID.isEmpty ? draftID:recordID
            try journal.changeProfile(owner,originals:newFile.map{[$0]} ?? []){p in
                var files=entries(p,"files"),drafts=entries(p,"examDrafts").filter{caption($0,"id") != draftID}
                if let f=newFile {files.append(["id":f.id,"examDraft":draftID,"name":f.name,"type":f.mime,"date":dayString(),"visit":"","category":"Черновики обследований","sourceDigest":ClinicalDuplicates.digest(f.bytes)])}
                let existingIDs=Set(files.filter{$0["examDraft"]==nil}.map{caption($0,"id")})
                guard sources.filter({$0["existing"] as? Bool==true}).allSatisfy({existingIDs.contains(caption($0,"id"))}) else {
                    throw JournalError("Один из выбранных документов больше недоступен в профиле.")
                }
                if final{
                    var exams=entries(p,"exams")
                    let old=exams.first{caption($0,"id")==newID} ?? [:]
                    if !recordID.isEmpty && old.isEmpty {throw JournalError("Исходная карточка недоступна.")}
                    let refs=entries(old,"attachments")+sources.map{["id":caption($0,"id")]}
                    guard !refs.isEmpty || !rows.isEmpty || !(args["description"] ?? "").trim.isEmpty || !(args["conclusion"] ?? "").trim.isEmpty else {throw JournalError("Добавьте протокол, снимок или результат.")}
                    var exam:JournalObject=args;exam["parameters"]=parameters;exam["attachments"]=refs;exam["id"]=newID
                    if args["method"]=="Другое",let custom=args["customMethod"],!custom.isEmpty {exam["method"]=custom}
                    exam.removeValue(forKey:"customMethod")
                    let sourceIDs:([JournalObject])->[String] = { references in
                        references.map{ref in
                            let id=caption(ref,"id"),file=files.first{caption($0,"id")==id} ?? [:]
                            let digest=caption(file,"sourceDigest")
                            return digest.isEmpty ? id : digest
                        }.sorted()
                    }
                    let sourceKey=sourceIDs(refs),key=ClinicalDuplicates.exam(exam)
                    if old.isEmpty || key != ClinicalDuplicates.exam(old) || !sources.isEmpty {
                        if let match=exams.first(where:{other in
                            guard caption(other,"id") != newID else {return false}
                            let otherSources=sourceIDs(entries(other,"attachments"))
                            return (!sourceKey.isEmpty && sourceKey==otherSources && !sources.contains{$0["existing"] as? Bool==true}) ||
                                (key != nil && key==ClinicalDuplicates.exam(other) && (sourceKey.isEmpty || otherSources.isEmpty || sourceKey==otherSources))
                        }) {throw DuplicateClinicalCard(id:caption(match,"id"))}
                    }
                    exams.removeAll{caption($0,"id")==newID};exams.append(exam);p["exams"]=exams
                    for i in files.indices {
                        if caption(files[i],"examDraft")==draftID,let s=sources.first(where:{caption($0,"id")==caption(files[i],"id")}) {
                            files[i].removeValue(forKey:"examDraft");files[i]["examId"]=newID;files[i]["category"]=s["protocol"] as? Bool==true ? "Заключения":"Снимки"
                        }
                        if caption(files[i],"examId")==newID {files[i]["visit"]=args["visit"];files[i]["date"]=args["date"]}
                    }
                }else{drafts.append(["id":draftID,"exam":recordID,"fields":args,"dateDefault":dateDefault,"parameters":parameters,"sources":sources,"reviewed":reviewed,"needsReview":hasProtocol,"position":sourcePosition.json])}
                p["files"]=files;p["examDrafts"]=drafts
            }
            if final{finished=true;duplicate=nil;dismiss()}
            else{notice="Черновик сохранён."}
            return true
        }catch{notice=error.localizedDescription;if final{duplicate=error as? DuplicateClinicalCard};return false}
    }
    @MainActor private func add(_ data:Data,_ name:String,_ mime:String) async throws{
        let file=NativeUpload(name:name,mime:mime,bytes:data)
        let profile=journal.profile(owner),exams=entries(profile,"exams"),files=entries(profile,"files")
        let current=exams.first{caption($0,"id")==recordID} ?? [:]
        let linked=Set((entries(current,"attachments")+sources).map{caption($0,"id")})
        let digest=ClinicalDuplicates.digest(data)
        if journal.matchingOriginal(owner:owner,file:file,digest:digest,rows:files.filter{linked.contains(caption($0,"id"))}) != nil {
            notice="Этот оригинал уже приложен.";return
        }
        if recordID.isEmpty,sources.isEmpty {
            let candidates=Set(exams.flatMap{entries($0,"attachments").map{caption($0,"id")}})
            if let used=journal.matchingOriginal(owner:owner,file:file,digest:digest,rows:files.filter{candidates.contains(caption($0,"id"))}),
               let exam=exams.first(where:{entries($0,"attachments").contains{caption($0,"id")==caption(used,"id")}}) {
                duplicate=DuplicateClinicalCard(id:caption(exam,"id"));notice="Этот оригинал уже есть в обследовании.";return
            }
        }
        sources.append(["id":file.id,"name":name,"type":mime,"protocol":protocolMode,"existing":false])
        if protocolMode {reviewed=false}
        guard save(newFile:file) else {sources.removeLast();return}
        if protocolMode {await recognize(file.id)}
    }
    @MainActor private func attachExisting(_ file:JournalObject) async {
        let id=caption(file,"id")
        guard !id.isEmpty,existingFiles.contains(where:{caption($0,"id")==id}) else {
            notice="Документ больше недоступен или уже приложен.";return
        }
        let wasReviewed=reviewed,isProtocol=protocolMode
        sources.append(["id":id,"name":caption(file,"name"),"type":caption(file,"type"),"protocol":isProtocol,"existing":true])
        if isProtocol {reviewed=false}
        guard save() else {sources.removeLast();reviewed=wasReviewed;return}
        if isProtocol {await recognize(id)}
    }
    @MainActor private func recognize(_ id:String) async {
        guard let index=sources.firstIndex(where:{caption($0,"id")==id}) else{return}
        reading=true;defer{reading=false}
        do{
            let blob=try await journal.attachment(owner:owner,id:id)
            let result=try await Task.detached{try ClinicalOCR.read(blob.bytes,mime:blob.type)}.value
            let parser=try ClinicalImport()
            guard let parsed=parser.js.objectForKeyedSubscript("parseExamProtocol")?.call(withArguments:[result.text])?.toDictionary() as? JournalObject else {throw JournalError("Не удалось разобрать протокол.")}
            var notes=(parsed["questions"] as? [String] ?? [])+result.warnings+result.uncertainLines.map{caption($0,"text")}
            for key in ["method","region","date","clinic","doctor","description","conclusion"] {
                let value=caption(parsed,key)
                guard !value.isEmpty else {continue}
                let field=fields[key] ?? ""
                if key=="date" && (dateDefault || field.trim.isEmpty) {
                    dateDefault=false;fields[key]=value
                } else if field.isEmpty {fields[key]=value}
                else if field != value {notes.append("Сверьте с протоколом: "+value)}
            }
            for item in entries(parsed,"parameters") {
                let value=ExamMeasurement(item)
                if !rows.contains(where:{$0.name==value.name && $0.value==value.value && $0.unit==value.unit}) {rows.append(value)}
            }
            sources[index]["text"]=result.text;sources[index]["note"]=notes.joined(separator:"\n")
            reviewed=false;save()
        }catch{notice=error.localizedDescription}
    }
}
