import SwiftUI
import UniformTypeIdentifiers
import PhotosUI
import Vision
import PDFKit

struct BinaryDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let bytes: Data
    init(_ data:Data) {bytes=data}
    init(configuration:ReadConfiguration) throws {guard let data=configuration.file.regularFileContents else {throw CocoaError(.fileReadCorruptFile)};bytes=data}
    func fileWrapper(configuration:WriteConfiguration) throws -> FileWrapper {FileWrapper(regularFileWithContents:bytes)}
}

struct PairDeviceView: View {
    @ObservedObject var journal:DeviceJournal
    @State private var identity:DeviceIdentity?
    @State private var share:BinaryDocument?
    @State private var exporting=false
    @State private var picking=false
    @State private var file:Data?
    @State private var code=""
    @State private var error:String?
    @State private var fileName=""
    @State private var validation=JournalFormValidation()
    var body:some View {
        let issues=[
            file == nil ? JournalFieldIssue(field:"access-file",message:"Выберите файл доступа.") : nil,
            .required("access-code",code,"Введите код от администратора.")
        ].compactMap{$0}
        let visible=validation.visible(issues)
        Form {
            Section("1. Запрос администратору") {
                if let identity {
                    Text(identity.fingerprint).font(.headline.monospaced())
                    Button("Сохранить запрос подключения") {
                        do {share=try BinaryDocument(identity.request(revision:journal.access["revision"] as? Int ?? 0)); exporting=true}
                        catch {self.error=error.localizedDescription}
                    }
                    Text("Передайте файл администратору и сверьте отпечаток устройства.").font(.footnote)
                } else if error == nil {ProgressView()}
            }
            Section("2. Доступ от администратора") {
                Button(fileName.isEmpty ? "Выбрать файл доступа" : fileName){picking=true}.journalField("access-file",visible)
                SecureField("Код от администратора",text:$code).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .journalField("access-code",visible)
                Button("Открыть доступные профили") {
                    guard validation.submit(issues),let file,let identity else {return}
                    do {try journal.install(file,code:code,identity:identity);self.file=nil;code="";error=nil}
                    catch {self.error=error.localizedDescription}
                }.disabled(identity==nil || journal.busy)
            }
            if let error {Text(error).foregroundStyle(.red)}
        }.journalValidation(validation).journalBackground().navigationTitle("Подключение iPhone").navigationBarTitleDisplayMode(.inline)
        .task {do {identity=try DeviceIdentity()} catch {self.error=error.localizedDescription}}
        .fileExporter(isPresented:$exporting,document:share,contentType:.data,defaultFilename:"device.health-request"){r in if case .failure(let e)=r {error=e.localizedDescription}}
        .fileImporter(isPresented:$picking,allowedContentTypes:[.data]){r in
            do {let url=try r.get();file=try readNativeFile(url);fileName=url.lastPathComponent} catch {self.error=error.localizedDescription}
        }
    }
}
func readNativeFile(_ url:URL) throws -> Data {
    let accessed=url.startAccessingSecurityScopedResource();defer{if accessed{url.stopAccessingSecurityScopedResource()}}
    return try Data(contentsOf:url)
}
struct DeviceHome:View {
    @ObservedObject var journal:DeviceJournal
    var chatGPTAccount: NativeChatGPTAccount?
    @Environment(\.scenePhase) private var phase
    @State private var exported:BinaryDocument?
    @State private var exporting=false
    @State private var requestingKey=false
    @ViewBuilder private var chatGPTLink: some View {
        if journal.editable {
            NavigationLink {
                NativeChatGPTSettings(account: chatGPTAccount)
            } label: {
                JournalRowLabel(title: "ИИ-провайдеры", symbol: "sparkles")
            }
        }
    }
    var body:some View {
        let family = journal.data["family"] as? JournalObject ?? [:]
        let familyName = caption(family,"name")
        NavigationStack {List {
            Section {
                JournalHero(title: familyName.isEmpty ? "Семья" : familyName, label: "Семейный дневник", symbol: "heart.text.square") {
                    EmptyView()
                }
            }
            Section {
                ForEach(journal.members.compactMap{$0["id"] as? String},id:\.self){id in
                    let member = journal.members.first{caption($0,"id")==id} ?? [:]
                    let name = caption(member,"name")
                    let role = caption(family,"adminId")==id ? "Администратор" : caption(member,"role")
                    NavigationLink {
                        DeviceProfile(journal:journal,owner:id)
                    } label: {
                        HStack(spacing: 12) {
                            Text(name.split(separator:" ").prefix(2).compactMap(\.first).map(String.init).joined())
                                .foregroundStyle(JournalTheme.green)
                                .font(JournalTheme.caption.weight(.semibold))
                                .frame(width: 42, height: 42)
                                .background(role=="Ребёнок" ? JournalTheme.child : JournalTheme.leaf, in: Circle())
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(name).font(JournalTheme.body.weight(.semibold)).foregroundStyle(JournalTheme.ink)
                                Text(role).font(JournalTheme.caption).foregroundStyle(JournalTheme.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .accessibilityLabel(name)
                    .accessibilityHint(role)
                }
            } header: {
                JournalSectionHeading("Профили")
            }
            Section {
                chatGPTLink
                NavigationLink {NativeTagLibrary(journal:journal)} label:{
                    JournalRowLabel(title:"Справочник тегов",symbol:"tag")
                }
            }
            if journal.admin {
                Section {
                    NavigationLink {DriveBackupView(journal:journal)} label:{
                        JournalRowLabel(title:"Google Диск",symbol:"folder")
                    }
                    NavigationLink {ArchiveBackupInspection()} label:{
                        JournalRowLabel(title:"Проверить файл копии",symbol:"checkmark.shield")
                    }
                    NavigationLink {CloudArchiveKeySettings(journal:journal)} label:{
                        JournalRowLabel(title:"Ключ восстановления в iCloud",symbol:"icloud")
                    }
                    Button {
                        if journal.hasLocalArchive {saveBackup()}
                        else {requestingKey=true}
                    } label: {
                        JournalRowLabel(title:"Сохранить зашифрованную копию",symbol:"lock.doc")
                    }.disabled(journal.busy)
                    if journal.hasLocalArchive {Button("Закрыть архив"){journal.lockAdmin()}}
                } header: {
                    JournalSectionHeading("Семейный архив")
                }
            }
            if journal.paired {Section {
                if journal.data["sync"] == nil {Text("Обмен появится после получения файла доступа с включённой синхронизацией.")}
                else {
                    let queue=journal.pendingProfiles
                    Text(journal.pending || !queue.isEmpty ? "Локальные правки ожидают отправки" : "Нет правок в очереди")
                    ForEach(queue.indices,id:\.self){index in
                        let item=queue[index]
                        DisclosureGroup(item.name){ForEach(item.changes.indices,id:\.self){Text(item.changes[$0])}}
                    }
                    if let last=journal.last, let date=ISO8601DateFormatter().date(from:last) ?? (try? Date(last,strategy:.iso8601.time(includingFractionalSeconds:true))) {LabeledContent("Последний обмен",value:date.formatted())}
                    Button(journal.busy ? "Идёт обмен…" : "Синхронизировать"){Task{await journal.sync()}}.disabled(journal.busy)
                }
                NavigationLink("Обновить доступ"){PairDeviceView(journal:journal)}
            } header: {
                JournalSectionHeading("Обмен")
            }}
            if let message=journal.message {Text(message).foregroundStyle(.secondary)}
        }.listStyle(.insetGrouped).listSectionSpacing(18).journalBackground()
            .navigationTitle("Лист здоровья").navigationBarTitleDisplayMode(.inline)}
        .fileExporter(isPresented:$exporting,document:exported,contentType:.data,defaultFilename:"family.health"){r in if case .failure(let e)=r {journal.message=e.localizedDescription}}
        .sheet(isPresented:$requestingKey){JournalBackupKeyForm(action:"Собрать копию",submit:saveBackup)}
        .onChange(of:phase){_,p in if p == .active {journal.schedule()}}
        .task {while !Task.isCancelled {try? await Task.sleep(for:.seconds(60));if !Task.isCancelled && phase == .active {await journal.sync()}}}
    }
    private func saveBackup(_ code:String=""){
        Task {
            do {exported=try await BinaryDocument(journal.exportAdmin(recoveryKey:code));exporting=true}
            catch {journal.message=error.localizedDescription}
        }
    }
}
private struct VisitDestination:Identifiable {let resumeID:String?;var id:String {resumeID ?? "new"}}
private struct DeviceProfile:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var visitEditor:VisitDestination?
    @State private var courseEditor:CourseEditorChoice?
    @State private var query=""
    var body:some View {
        let p=journal.profile(owner)
        let tags=RecordTags(profile:p,library:entries(journal.data,"tags"))
        let name=journal.members.first{caption($0,"id")==owner}.map{caption($0,"name")} ?? "Профиль"
        let fields=entries(p,"fields")
        let visits=NativeTreatments.visits(p).sorted{NativeTreatments.field($0,1)>NativeTreatments.field($1,1)}
        let courses=NativeTreatments.all(p),currentCourses=courses.filter(\.active)
        let courseIndex=Dictionary(grouping:courses,by:\.visit),noteIndex=Dictionary(grouping:entries(p,"notes")){caption($0,"visit")}
        let details:([Any])->[String]={row in
            let id=NativeTreatments.field(row,0)
            return (courseIndex[id] ?? []).map(\.title)+(noteIndex[id] ?? []).map{caption($0,"text")}
                + [NativeTreatments.field(row,5)]
        }
        let matches=visits.filter{row in
            let doctorID=NativeTreatments.field(row,3)
            let doctor=entries(p,"addedDoctors").first{caption($0,"id")==doctorID}?["values"] as? [String] ?? []
            return tags.matches(query,key:"visit:"+NativeTreatments.field(row,0),fields:[
                NativeTreatments.field(row,2),NativeTreatments.field(row,4)]+doctor+details(row))
        }
        List {
            Section {
                JournalHero(title:name,label:"Профиль здоровья") {
                    let stats=profileStats(fields)
                    if !stats.isEmpty {
                        Text(stats.joined(separator:"  ·  ")).font(JournalTheme.caption).foregroundStyle(JournalTheme.secondary)
                    }
                    NavigationLink {PatientFields(journal:journal,owner:owner)} label:{
                        Label("Открыть медкарту",systemImage:"book")
                            .font(JournalTheme.caption.weight(.semibold))
                            .foregroundStyle(JournalTheme.green)
                            .padding(.horizontal,12)
                            .frame(minHeight:44)
                            .background(.white.opacity(0.84),in:.rect(cornerRadius:9))
                            .overlay{RoundedRectangle(cornerRadius:9).strokeBorder(JournalTheme.line)}
                    }.buttonStyle(.borderless)
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
            if query.isEmpty && !currentCourses.isEmpty {
                TreatmentSection(journal:journal,owner:owner,courses:currentCourses,editor:$courseEditor)
            }
            if journal.editable && query.isEmpty && currentCourses.isEmpty {
                Button("Новый визит",systemImage:"plus"){visitEditor=VisitDestination(resumeID:nil)}
                    .buttonStyle(JournalPrimaryButton()).disabled(journal.busy)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            Section {
                let displayed=query.isEmpty ? Array(matches.prefix(3)):matches
                if displayed.isEmpty {
                    Text(query.isEmpty ? "Визитов пока нет" : "По этому запросу визитов нет")
                        .font(JournalTheme.body).foregroundStyle(JournalTheme.secondary)
                }
                ForEach(displayed.indices,id:\.self){i in
                    let row=displayed[i]
                    let hit=query.trim.isEmpty ? nil:details(row).first{tags.matches(query,key:"",fields:[$0])}
                    visitLink(row,searchMatch:hit)
                }
                if query.isEmpty && visits.count>3 {
                    NavigationLink("Все визиты · "+String(visits.count)){
                        List{ForEach(visits.indices,id:\.self){i in visitLink(visits[i])}}
                            .journalBackground().navigationTitle("История визитов")
                    }
                }
            } header: {
                JournalSectionHeading(query.isEmpty ? "Последние визиты":"Найденные визиты")
            }
            if query.isEmpty && currentCourses.isEmpty {
                TreatmentSection(journal:journal,owner:owner,courses:currentCourses,editor:$courseEditor)
            }
            if journal.editable && query.isEmpty {
                let pending=entries(p,"visitDrafts").filter{caption($0,"parent").isEmpty}
                if !pending.isEmpty {Section("Черновики визитов"){
                    ForEach(pending.indices,id:\.self){i in
                        Button(caption(pending[i],"name")){visitEditor=VisitDestination(resumeID:caption(pending[i],"id"))}
                    }
                }}
            }
            if journal.editable && query.isEmpty {
                let ids=Set(entries(p,"treatmentQueue").map{caption($0,"id")})
                let queued=NativeTreatments.visits(p).filter{ids.contains(NativeTreatments.field($0,0))}
                if !queued.isEmpty {
                    Section("Ожидают разбора лечения"){
                        ForEach(queued.indices,id:\.self){index in
                            let row=queued[index]
                            NavigationLink(NativeTreatments.field(row,2)){
                                NativeTreatmentReview(journal:journal,owner:owner,visit:NativeTreatments.field(row,0))
                            }
                        }
                    }
                }
            }
            if query.isEmpty {
                NativeClinicalLinks(journal:journal,owner:owner)
                if journal.editable {
                    NavigationLink("Управление данными"){ManageNativeRecords(journal:journal,owner:owner)}
                }
                ProfileSyncLinks(journal:journal,owner:owner)
            } else {
                NativeClinicalSearch(journal:journal,owner:owner,query:query,tags:tags)
            }
            Section {
                NativeFiles(journal:journal,owner:owner,items:entries(p,"files").filter{file in
                    let kind=file["lab"] != nil || caption(file,"category")=="Лаборатория" ? "lab:" : "file:"
                    return file["examDraft"] == nil && (query.isEmpty || file["lab"]==nil)
                        && tags.matches(query,key:kind+caption(file,"id"),fields:[caption(file,"name"),caption(file,"category")])
                })
            } header: {
                JournalSectionHeading("Документы")
            }
        }.listStyle(.insetGrouped).listSectionSpacing(18).journalBackground()
        .navigationTitle("Профиль").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if journal.editable && !currentCourses.isEmpty {
                ToolbarItem(placement:.topBarTrailing) {
                    Button("Новый визит",systemImage:"plus"){visitEditor=VisitDestination(resumeID:nil)}
                        .labelStyle(.iconOnly).disabled(journal.busy)
                }
            }
        }
        .searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Визит, лекарство, анализ или тег")
        .sheet(item:$visitEditor){destination in VisitEditor(journal:journal,owner:owner,resumeID:destination.resumeID)}
        .sheet(item:$courseEditor){CourseEditorDestination(journal:journal,owner:owner,choice:$0)}
    }
    private func profileStats(_ fields:[JournalObject])->[String] {
        func value(_ id:String)->String {fields.first{caption($0,"id")==id}.map{caption($0,"value")} ?? ""}
        var stats=[String]()
        if let birth=CoursePeriod.date(value("birthday")),birth<=Date(),
           let years=Calendar.current.dateComponents([.year],from:birth,to:Date()).year {
            let suffix=(11...14).contains(years%100) ? "лет" : years%10==1 ? "год" : (2...4).contains(years%10) ? "года" : "лет"
            stats.append("\(years) \(suffix)")
        }
        for (title, reading) in [("Рост",value("height")),("Вес",value("weight"))] where !reading.isEmpty {
            stats.append(title+" "+reading)
        }
        return stats
    }
    private func visitLink(_ row:[Any],searchMatch:String?=nil)->some View {
        let doctor=entries(journal.profile(owner),"addedDoctors")
            .first{caption($0,"id")==NativeTreatments.field(row,3)}?["values"] as? [String] ?? []
        let doctorName=doctor.prefix(2).reversed().filter{!$0.isEmpty}.joined(separator:" · ")
        let detail=doctorName.isEmpty ? NativeTreatments.field(row,4) : doctorName
        return NavigationLink {NativeVisitDetails(journal:journal,owner:owner,row:row)} label:{
            VStack(alignment:.leading,spacing:4){
                JournalVisitLabel(title:NativeTreatments.field(row,2),day:NativeTreatments.field(row,1),detail:detail)
                if let searchMatch {Text(searchMatch).font(.caption).foregroundStyle(.secondary).lineLimit(3)}
            }
        }
    }
}
struct MedicalFieldDestination: Identifiable {
    let field:JournalObject
    var id:String {caption(field,"id")}
}

struct MedicalFieldEditor: View {
    let journal:DeviceJournal,owner:String,destination:MedicalFieldDestination
    @Environment(\.dismiss) private var dismiss
    @State private var label:String
    @State private var value:String
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    private static let standard=[
        "Дата рождения":"birthday","Рост":"height","Вес":"weight","Дата измерений":"measured",
        "Аллергии":"allergy","Хронические заболевания":"chronic"
    ]
    init(journal:DeviceJournal,owner:String,destination:MedicalFieldDestination){
        self.journal=journal;self.owner=owner;self.destination=destination
        _label=State(initialValue:caption(destination.field,"label"))
        _value=State(initialValue:caption(destination.field,"value"))
    }
    private func fieldID(in fields:[JournalObject]) -> String {
        if !destination.id.isEmpty {return destination.id}
        let key=Self.standard.first{ClinicalDuplicates.text($0.key)==ClinicalDuplicates.text(label)}?.value ?? ""
        return fields.contains{caption($0,"id")==key} ? "" : key
    }
    private func issues(in fields:[JournalObject]) -> [JournalFieldIssue] {
        let duplicate=fields.contains{caption($0,"id") != destination.id &&
            ClinicalDuplicates.text(caption($0,"label"))==ClinicalDuplicates.text(label)}
        let invalidDate=["birthday","measured"].contains(fieldID(in:fields)) &&
            (CoursePeriod.date(value.trim)==nil || value.trim>dayString())
        return [
            .required("label",label,"Введите название поля.") ?? .length("label",label,limit:64) ??
                (duplicate ? JournalFieldIssue(field:"label",message:"Поле с таким названием уже есть.") : nil),
            .required("value",value,"Введите значение.") ?? .length("value",value,limit:280) ??
                (invalidDate ? JournalFieldIssue(field:"value",message:"Введите дату в формате ГГГГ-ММ-ДД, не позже сегодняшнего дня.") : nil)
        ].compactMap{$0}
    }
    var body:some View {
        let issues=issues(in:entries(journal.profile(owner),"fields"))
        let visible=validation.visible(issues)
        NavigationStack {
            Form {
                TextField("Название поля",text:$label).journalField("label",visible)
                TextField("Значение",text:$value,axis:.vertical).lineLimit(2...5).journalField("value",visible)
                if let error {Text(error).foregroundStyle(.red)}
                Button("Сохранить поле"){if validation.submit(issues){save()}}
            }.journalValidation(validation).journalBackground().navigationTitle(destination.id.isEmpty ? "Новое поле":"Изменить поле")
                .toolbar {ToolbarItem(placement:.cancellationAction){Button("Отмена"){dismiss()}}}
        }
    }
    private func save(){
        do {
            let name=label.trim,text=value.trim,original=destination.id
            try journal.changeProfile(owner){profile in
                var fields=entries(profile,"fields")
                if let issue=issues(in:fields).first {throw JournalError(issue.message)}
                let standardOrOriginal=fieldID(in:fields)
                let id=standardOrOriginal.isEmpty ? UUID().uuidString : standardOrOriginal
                if original.isEmpty {fields.append(["id":id,"label":name,"value":text])}
                else {
                    guard let index=fields.firstIndex(where:{caption($0,"id")==original}),
                          try jsonBytes(fields[index])==jsonBytes(destination.field) else {
                        throw JournalError("Поле изменилось. Откройте его снова.")
                    }
                    fields[index]["label"]=name;fields[index]["value"]=text
                }
                profile["fields"]=fields
            }
            dismiss()
        } catch {self.error=error.localizedDescription}
    }
}

struct NativeFiles: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String, items:[JournalObject]
    var body:some View {ForEach(items.indices,id:\.self){i in
        NativeFileLink(journal:journal,owner:owner,file:items[i])
    }}
}

struct NativeFileLink:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,file:JournalObject
    @State private var error=""
    var body:some View {
        let id=caption(file,"id"),name=caption(file,"name")
        NavigationLink {DeviceAttachment(journal:journal,owner:owner,id:id,name:name)} label:{NativeDocumentLabel(file:file)}
            .accessibilityLabel(name)
            .swipeActions(allowsFullSwipe:false) {
                if !journal.cachedIDs(owner).contains(id) {
                    Button("Сохранить без сети",systemImage:"arrow.down.circle"){
                        Task {do {try await journal.saveOffline(owner:owner,ids:[id])}catch{self.error=error.localizedDescription}}
                    }.tint(JournalTheme.green).disabled(journal.busy)
                }
            }
            .alert("Файл не сохранён",isPresented:Binding(get:{!error.isEmpty},set:{if !$0 {error=""}})) {
                Button("Закрыть",role:.cancel){error=""}
            } message:{Text(error)}
    }
}
struct DeviceAttachment:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,id:String,name:String
    @State private var original:FamilyArchive.Original?
    @State private var error:String?
    var body:some View {
        Group {if let original {AttachmentView(original:original,name:name)}
            else if let error {ContentUnavailableView(error,systemImage:"doc")}
            else {ProgressView("Открываем документ…")}}
        .navigationTitle(name).task {do {original=try await journal.attachment(owner:owner,id:id)} catch {self.error=error.localizedDescription}}
    }
}
struct NativeVisitDetails:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    private let original:[Any]
    @State private var courseEditor:CourseEditorChoice?
    @State private var editing=false
    init(journal:DeviceJournal,owner:String,row:[Any]){self.journal=journal;self.owner=owner;original=row}
    var body:some View {
        let p=journal.profile(owner),visit=NativeTreatments.field(original,0)
        let row=NativeTreatments.visits(p).first{NativeTreatments.field($0,0)==visit} ?? original
        let title=NativeTreatments.field(row,2),date=NativeTreatments.field(row,1)
        List {
            Section {
                JournalHero(title:title,label:"Визит",symbol:"calendar") {
                    if !date.isEmpty {Text(date).font(JournalTheme.caption).foregroundStyle(JournalTheme.secondary)}
                }
            }
            Section {
                if let episode=row[4] as? String,!episode.isEmpty {Text(episode)}
                NativeDoctorLink(journal:journal,owner:owner,visit:visit)
                let doctor=NativeDoctorLink.values(profile:p,id:NativeTreatments.field(row,3))
                let clinic=row.count>9 ? NativeTreatments.field(row,9) : (doctor.count>2 ? doctor[2] : "")
                if !clinic.isEmpty {LabeledContent("Клиника",value:clinic)}
                if let note=row[5] as? String,!note.isEmpty {Text(note)}
                if journal.editable{Button("Редактировать визит",systemImage:"square.and.pencil"){editing=true}}
            } header: {
                JournalSectionHeading("Приём")
            }
            TreatmentSection(journal:journal,owner:owner,visit:visit,editor:$courseEditor)
            NavigationLink {NativeTreatmentReview(journal:journal,owner:owner,visit:visit)} label:{
                JournalRowLabel(title:"Разбор лечения и цены лекарств",symbol:"sparkles")
            }
            TreatmentDecisions(rows:entries(p,"changes").filter{caption($0,"visit")==visit},profile:p)
            NavigationLink {VisitBrief(journal:journal,owner:owner,episodeID:NativeTreatments.episode(row,p))} label:{
                JournalRowLabel(title:"Сводка по этому эпизоду",symbol:"list.bullet.clipboard")
            }
            NativeRecordTags(journal:journal,owner:owner,kind:.visit,id:visit)
            VisitNotes(journal:journal,owner:owner,visit:visit)
            Section("Результаты обследований"){ExamLinks(journal:journal,owner:owner,rows:entries(p,"exams").filter{caption($0,"visit")==visit})}
            Section("Рекомендации врача"){
                ForEach(entries(p,"recommendations").filter{caption($0,"visit")==visit}.map{caption($0,"text")},id:\.self){Text($0)}
                let sheets=entries(p,"files").filter{caption($0,"visit")==visit && $0["checked"] as? Bool==true && !caption($0,"recommendation").isEmpty}
                ForEach(sheets.indices,id:\.self){i in
                    let sheet=sheets[i]
                    Text(caption(sheet,"recommendation"))
                    NavigationLink("Оригинал рекомендации"){DeviceAttachment(journal:journal,owner:owner,id:caption(sheet,"id"),name:caption(sheet,"name"))}
                }
            }
            Section("Вложения"){
                VisitAttachmentLinks(journal:journal,owner:owner,rows:entries(p,"files").filter{caption($0,"visit")==visit})
                if journal.editable {
                    NavigationLink("Прикрепить фото, PDF или другой файл"){
                        VisitAttachmentIntake(journal:journal,owner:owner,visit:visit)
                    }.disabled(journal.busy)
                }
            }
        }.listSectionSpacing(18).journalBackground().navigationTitle("Приём").navigationBarTitleDisplayMode(.inline)
        .sheet(item:$courseEditor){CourseEditorDestination(journal:journal,owner:owner,choice:$0)}
        .sheet(isPresented:$editing){NavigationStack{VisitMetadataEditor(journal:journal,owner:owner,row:row)}}
    }
}

private struct VisitMetadataEditor: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    private let expected:[Any]
    @Environment(\.dismiss) private var dismiss
    @State private var title:String
    @State private var date:Date
    @State private var doctor:String
    @State private var clinic:String
    @State private var note:String
    @State private var notice=""
    @State private var duplicate:DuplicateClinicalCard?
    @State private var validation=JournalFormValidation()

    init(journal:DeviceJournal,owner:String,row:[Any]){
        self.journal=journal;self.owner=owner;expected=row
        let doctorID=NativeTreatments.field(row,3)
        let values=entries(journal.profile(owner),"addedDoctors").first{caption($0,"id")==doctorID}?["values"] as? [String] ?? []
        _title=State(initialValue:NativeTreatments.field(row,2));_doctor=State(initialValue:doctorID)
        _date=State(initialValue:CoursePeriod.date(NativeTreatments.field(row,1)) ?? Date())
        _clinic=State(initialValue:row.count>9 ? NativeTreatments.field(row,9) : values.dropFirst(2).first ?? "")
        _note=State(initialValue:NativeTreatments.field(row,5))
    }
    var body:some View {
        let doctors=entries(journal.profile(owner),"addedDoctors")
        let issues=[JournalFieldIssue.required("visit-title",title,"Введите название визита.")].compactMap{$0}
        Form {
            TextField("Название визита",text:$title).journalField("visit-title",validation.visible(issues))
            DatePicker("Дата визита",selection:$date,in:...Date(),displayedComponents:.date)
            Picker("Врач",selection:$doctor){
                if !doctors.contains(where:{caption($0,"id")==doctor}){Text("Текущий врач").tag(doctor)}
                ForEach(doctors.indices,id:\.self){i in
                    let values=doctors[i]["values"] as? [String] ?? []
                    Text([values.dropFirst().first,values.first].compactMap{$0}.filter{!$0.isEmpty}.joined(separator:" · ")).tag(caption(doctors[i],"id"))
                }
            }
            TextField("Клиника",text:$clinic)
            TextField("Сведения о визите",text:$note,axis:.vertical)
            if !notice.isEmpty {Text(notice).foregroundStyle(.red)}
            if let duplicate,let row=NativeTreatments.visits(journal.profile(owner)).first(where:{NativeTreatments.field($0,0)==duplicate.id}){
                NavigationLink("Открыть существующий визит"){NativeVisitDetails(journal:journal,owner:owner,row:row)}
            }
        }.journalValidation(validation).journalBackground().navigationTitle("Редактировать визит")
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button("Отмена"){dismiss()}}
                ToolbarItem(placement:.confirmationAction){Button("Сохранить изменения"){
                    guard validation.submit(issues) else{return}
                    do {
                        duplicate=nil
                        try journal.editVisit(owner:owner,expected:expected,title:title,day:dayString(date),doctor:doctor,clinic:clinic,note:note)
                        dismiss()
                    } catch {duplicate=error as? DuplicateClinicalCard;notice=error.localizedDescription}
                }.disabled(journal.busy || !journal.editable)}
            }
    }
}

private struct VisitEditor: View {
    @Environment(\.nativeChatGPT) private var chatGPT
    @Environment(\.nativeAPIKeys) private var apiKeys
    @ObservedObject var journal:DeviceJournal
    let owner:String
    var resumeID:String?=nil
    @State private var previous=[JournalObject]()
    @State private var restored=false
    @State private var finished=false
    @Environment(\.dismiss) var dismiss
    @State private var draft=NativeVisitDraft()
    @State private var picking=false
    @State private var photos:[PhotosPickerItem]=[]
    @State private var error:String?
    @State private var raw=""
    @State private var reading=false
    @State private var camera=false
    @State private var duplicate:DuplicateClinicalCard?
    @State private var transcriptionSource:NativeUpload?
    @State private var validation=JournalFormValidation()
    private var needsReview:Bool {draft.files.contains{$0.readCategory != nil}}
    private func validationIssues(episodes:[JournalObject]) -> [JournalFieldIssue] {
        let episodeIssue=draft.episodeID == nil ?
            JournalFieldIssue.required("episode-name",draft.episode,"Введите название эпизода.") :
            (episodes.contains{caption($0,"id")==draft.episodeID} ? nil : JournalFieldIssue(field:"episode",message:"Выберите доступный эпизод."))
        return [
            episodeIssue,
            .required("visit-title",draft.title,"Введите название визита."),
            .required("doctor",draft.doctor,"Введите ФИО врача."),
            needsReview && !draft.checked ? JournalFieldIssue(field:"visit-review",message:"Подтвердите сверку с оригиналами.") : nil
        ].compactMap{$0}+draft.medicines.flatMap(\.validationIssues)
    }
    var body:some View {
        let episodes=entries(journal.profile(owner),"episodes")
        let issues=validationIssues(episodes:episodes)
        let visible=validation.visible(issues)
        NavigationStack { Form {
            Section("Визит") {
                Picker("Эпизод",selection:$draft.episodeID){Text("Новый эпизод").tag(String?.none)
                    ForEach(episodes.indices,id:\.self){i in Text(episodes[i]["name"] as? String ?? "").tag(episodes[i]["id"] as? String)}
                }.journalField("episode",visible).onChange(of:draft.episodeID){_,id in draft.episode=episodes.first{$0["id"] as? String==id}?["name"] as? String ?? ""}
                if draft.episodeID==nil {TextField("Название эпизода",text:$draft.episode).journalField("episode-name",visible)}
                TextField("Название визита",text:$draft.title).journalField("visit-title",visible)
                DatePicker("Дата",selection:Binding(get:{draft.date},set:{draft.date=$0;draft.recognizedDate=true}),in:...Date(),displayedComponents:.date)
                TextField("Специализация",text:$draft.specialty)
                TextField("ФИО врача",text:$draft.doctor).journalField("doctor",visible)
                TextField("Клиника",text:$draft.clinic)
            }
            Section("Вложения") {
                Button("Добавить фото, PDF или текст"){picking=true}
                PhotosPicker("Выбрать фотографии",selection:$photos,matching:.images)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {Button("Снять назначение"){camera=true}}
                ForEach($draft.files){$file in
                    NavigationLink("Открыть оригинал · "+file.name){AttachmentView(original:.init(id:file.id,type:file.mime,bytes:file.bytes),name:file.name)}
                    if file.category=="Лаборатория" {
                        NavigationLink("Сверить показатели"){LabEditor(lab:Binding(get:{file.lab ?? LabResult()},set:{file.lab=$0}))}
                    }
                    if file.readCategory != nil && ["Назначения","Рекомендации"].contains(file.category) {
                        Button("Уточнить текст с оригинала"){transcriptionSource=file}.disabled(reading || journal.busy)
                    }
                    Picker(file.name,selection:$file.category){ForEach(["Назначения","Рекомендации","Лаборатория","Заключения","Снимки","Другое"],id:\.self){Text($0)}}.disabled(file.readCategory != nil || reading)
                    ForEach(file.warnings,id:\.self){Text($0).foregroundStyle(.orange)}
                    if !file.issues.isEmpty {DisclosureGroup("Строки для сверки · "+String(file.issues.count)){ForEach(file.issues.indices,id:\.self){i in Text(caption(file.issues[i],"text"))}}}
                }
                if !draft.files.isEmpty {Button(reading ? "Распознаём…" : "Распознать на iPhone"){recognize()}.disabled(reading)}
                if !raw.isEmpty {Text(raw).textSelection(.enabled);Text("Сверьте название и дозировку с оригиналом перед сохранением.").font(.footnote)}
            }
            if needsReview {
                if !draft.recognizedDate {Text("Уточните дату визита по оригиналу.").foregroundStyle(.orange)}
                Toggle("Поля и дата сверены с оригиналами",isOn:$draft.checked).journalField("visit-review",visible)
            }
            Section("Назначения") {
                ForEach($draft.medicines){$m in VStack(alignment:.leading) {
                    TextField("Лекарство",text:$m.name).journalField(m.field("name"),visible)
                    TextField("Дозировка",text:$m.strength).journalField(m.field("strength"),visible)
                    TextField("Форма",text:$m.form)
                    TextField("Схема приёма",text:$m.instructions).journalField(m.field("instructions"),visible)
                }}
                .onDelete{draft.medicines.remove(atOffsets:$0)}
                Button("Добавить лекарство"){draft.medicines.append(NativeMedicine())}
            }
            Section("Рекомендации врача"){TextField("Текст рекомендаций",text:$draft.recommendation,axis:.vertical)}
            Section("Сведения из визита"){TextField("Жалобы и запись врача",text:$draft.note,axis:.vertical)}
            if let error {Text(error).foregroundStyle(.red)}
            if let duplicate,let row=NativeTreatments.visits(journal.profile(owner)).first(where:{NativeTreatments.field($0,0)==duplicate.id}){
                NavigationLink("Открыть существующий визит"){NativeVisitDetails(journal:journal,owner:owner,row:row)}
            }
            if !draft.files.isEmpty {
                Button("Отложить сверку визита"){if persist(){dismiss()}}.disabled(reading || journal.busy)
            }
        }.journalValidation(validation).journalBackground().disabled(!restored).navigationTitle("Новый визит").toolbar {
            ToolbarItem(placement:.cancellationAction){Button(draft.files.isEmpty ? "Отмена":"Закрыть"){if !restored || draft.files.isEmpty || persist(){dismiss()}}.disabled(reading)}
            ToolbarItem(placement:.confirmationAction){Button("Сохранить"){
                guard validation.submit(issues) else{return}
                do {
                    duplicate=nil
                    let visit=try journal.saveVisit(owner:owner,draft:draft,expectedDraft:previous)
                    if let chatGPT,apiKeys?.preferredProvider == nil || apiKeys?.preferredProvider == .chatGPT,
                       NativeTreatmentDelivery.allowsAutomatic(journal,owner:owner),
                       let request=try? NativeTreatmentDelivery.prepare(journal,owner:owner,visit:visit){
                        Task {
                            do {try await NativeTreatmentDelivery.send(journal,owner:owner,visit:visit,request:request,automatic:true,via:chatGPT)}
                            catch {journal.message=error.localizedDescription}
                        }
                    }
                    finished=true;dismiss()
                }
                catch{duplicate=error as? DuplicateClinicalCard;self.error=error.localizedDescription}
            }.disabled(!restored || journal.busy || reading)}
        }}.task{await loadDraft()}.interactiveDismissDisabled(!draft.files.isEmpty)
        .sheet(item:$transcriptionSource){file in
            VisitTranscriptionEditor(file:file){text in try applyTranscription(text,fileID:file.id)}
        }
        .onChange(of:draft.files.map(\.id)){_,_ in if restored && !draft.files.isEmpty {_=persist()}}
        .fullScreenCover(isPresented:$camera){NativeCamera{bytes in draft.files.append(NativeUpload(name:"Назначение.jpg",mime:"image/jpeg",bytes:bytes))}.ignoresSafeArea()}
        .fileImporter(isPresented:$picking,allowedContentTypes:[.data],allowsMultipleSelection:true){result in
            do {let uploads=try result.get().map{url in NativeUpload(name:url.lastPathComponent,mime:UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",bytes:try readNativeFile(url))};draft.files.append(contentsOf:uploads)}
            catch {self.error=error.localizedDescription}
        }.onChange(of:photos){_,items in Task {
            do {for item in items {
                if let bytes=try await item.loadTransferable(type:Data.self) {
                    let type=item.supportedContentTypes.first ?? .image
                    draft.files.append(NativeUpload(name:"Фото "+String(draft.files.count+1)+"."+(type.preferredFilenameExtension ?? "jpg"),mime:type.preferredMIMEType ?? "image/jpeg",bytes:bytes))
                }
            };photos=[]}catch{self.error=error.localizedDescription}
        }}
    }
    @MainActor private func loadDraft() async {
        guard !restored else{return}
        guard let id=resumeID else{restored=true;return}
        do {
            let p=journal.profile(owner),rows=VisitDrafts.group(in:p,id:id)
            var bytes=[String:Data]()
            for row in rows {
                let key=caption(row,"id");bytes[key]=try await journal.attachment(owner:owner,id:key).bytes
            }
            try VisitDrafts.check(journal.profile(owner),id:id,expected:rows)
            draft=try VisitDrafts.restore(rows,profile:p,originals:bytes);previous=rows
            raw=draft.files.map(\.raw).filter{!$0.isEmpty}.joined(separator:"\n\n");restored=true
        }catch{self.error=error.localizedDescription}
    }
    @discardableResult private func persist()->Bool {
        guard restored,!finished,let id=draft.files.first?.id else{return false}
        let docs=VisitDrafts.documents(draft,previous:previous)
        if NSArray(array:previous).isEqual(to:docs){return true}
        let cached=journal.cachedIDs(owner)
        do {
            try journal.changeProfile(owner,originals:draft.files.filter{!cached.contains($0.id)}){p in
                try VisitDrafts.check(p,id:id,expected:previous)
                p["visitDrafts"]=entries(p,"visitDrafts").filter{caption($0,"id") != id && caption($0,"parent") != id}+docs
            }
            previous=docs;return true
        }catch{self.error=error.localizedDescription;return false}
    }
    private func applyTranscription(_ text:String,fileID:String) throws {
        guard let index=draft.files.firstIndex(where:{$0.id==fileID}) else {throw JournalError("Оригинал недоступен.")}
        let previousDraft=draft
        let original=draft.files[index]
        var upload=original,parsed=NativeVisitDraft()
        try ClinicalImport().apply(text:text,upload:&upload,draft:&parsed)
        upload.raw=original.raw;upload.transcription=text
        draft.files[index]=upload
        if draft.title.isEmpty {draft.title=parsed.title}
        if draft.episode.isEmpty && draft.episodeID==nil {draft.episode=parsed.episode}
        if draft.doctor.isEmpty {draft.doctor=parsed.doctor}
        if draft.specialty.isEmpty {draft.specialty=parsed.specialty}
        if draft.clinic.isEmpty {draft.clinic=parsed.clinic}
        if draft.note.isEmpty {draft.note=parsed.note}
        if draft.recommendation.isEmpty {draft.recommendation=parsed.recommendation}
        if draft.medicines.isEmpty {draft.medicines=parsed.medicines}
        if !draft.recognizedDate && dayString(draft.date)==dayString() && parsed.recognizedDate {
            draft.date=parsed.date;draft.recognizedDate=true
        }
        draft.checked=false
        if !persist(){draft=previousDraft;throw JournalError(error ?? "Не удалось сохранить сверенный текст.")}
    }
    func recognize() {
        let files=draft.files.filter { $0.readCategory == nil && ["Назначения","Рекомендации","Лаборатория","Заключения"].contains($0.category) && !$0.name.lowercased().hasSuffix(".zip") }
        guard !files.isEmpty else {return}
        reading=true;error=nil;draft.checked=false
        Task {
            defer { reading=false }
            do {
                let parser=try ClinicalImport()
                for file in files {
                    let result=await Task.detached {
                        do {return try ClinicalOCR.read(file.bytes,mime:file.mime)}
                        catch {return RecognizedDocument(warnings:[error.localizedDescription])}
                    }.value
                    guard let index=draft.files.firstIndex(where:{$0.id==file.id}) else {continue}
                    var upload=draft.files[index]
                    upload.issues=result.uncertainLines;upload.warnings=result.warnings;upload.readCategory=file.category
                    if !result.text.isEmpty {
                        parser.apply(text:result.text,issues:result.uncertainLines,upload:&upload,draft:&draft)
                    } else if upload.warnings.isEmpty {upload.warnings=["Текст не распознан. Заполните сведения по оригиналу."]}
                    draft.files[index]=upload
                    _=persist()
                }
                raw=draft.files.map(\.raw).filter{!$0.isEmpty}.joined(separator:"\n\n")
            } catch {self.error=error.localizedDescription}
        }
    }
}

private struct VisitTranscriptionEditor:View {
    let file:NativeUpload,apply:(String)throws->Void
    @State private var text:String
    @State private var error=""
    @State private var validation=JournalFormValidation()
    @Environment(\.dismiss) private var dismiss
    init(file:NativeUpload,apply:@escaping (String)throws->Void) {
        self.file=file;self.apply=apply;_text=State(initialValue:file.transcription ?? file.raw)
    }
    var body:some View {
        let issues=[JournalFieldIssue.required("transcription",text,"Введите сверенный текст.")].compactMap{$0}
        NavigationStack {
            Form {
                NavigationLink("Открыть оригинал"){
                    AttachmentView(original:.init(id:file.id,type:file.mime,bytes:file.bytes),name:file.name)
                }
                TextField("Сверенный текст",text:$text,axis:.vertical).lineLimit(6...16).accessibilityLabel("Сверенный текст")
                    .journalField("transcription",validation.visible(issues))
                Text("Внесите читаемые строки. Если дозу или схему разобрать нельзя, оставьте пропуск для уточнения.")
                    .font(.footnote).foregroundStyle(.secondary)
                if !error.isEmpty {Text(error).foregroundStyle(.red)}
            }.journalValidation(validation).navigationTitle("Уточнение текста").toolbar {
                ToolbarItem(placement:.cancellationAction){Button("Отмена"){dismiss()}}
                ToolbarItem(placement:.confirmationAction){Button("Заполнить пропуски"){
                    guard validation.submit(issues) else{return}
                    do {try apply(text.trim);dismiss()}catch{self.error=error.localizedDescription}
                }}
            }
        }
    }
}
