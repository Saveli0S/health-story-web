import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

extension DeviceJournal {
    func addLabOriginals(owner:String, uploads:[NativeUpload]) throws -> [String] {
        guard editable,!busy,members.contains(where:{caption($0,"id")==owner}) else {throw JournalError("Нет доступа к записи или идёт обмен.")}
        let old=entries(profile(owner),"files").filter{caption($0,"category")=="Лаборатория"}
        var selected=[String](), additions=[NativeUpload](), staged=[JournalObject]()
        for file in uploads {
            let digest=ClinicalDuplicates.digest(file.bytes)
            if let existing=matchingOriginal(owner:owner,file:file,digest:digest,rows:old+staged) {
                selected.append(caption(existing,"id"));continue
            }
            additions.append(file);selected.append(file.id)
            staged.append(["id":file.id,"name":file.name,"type":file.mime,"size":file.bytes.count,"date":dayString(),
                           "category":"Лаборатория","visit":"","sourceDigest":digest])
        }
        if !staged.isEmpty {try changeProfile(owner,originals:additions){$0["files"]=entries($0,"files")+staged}}
        return selected
    }
}

struct LabIntake:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var ids=[String]()
    @State private var picker=false
    @State private var camera=false
    @State private var photos=[PhotosPickerItem]()
    @State private var error=""
    @State private var importing=false
    var body:some View {
        Form {
            Section("Добавить оригиналы"){
                Button("Выбрать фото или PDF из файлов"){picker=true}
                PhotosPicker("Из фото",selection:$photos,matching:.images)
                if UIImagePickerController.isSourceTypeAvailable(.camera){Button("Снять бланк"){camera=true}}
            }.disabled(importing || journal.busy || !journal.editable)
            if !ids.isEmpty {Section("Бланки"){
                ForEach(entries(journal.profile(owner),"files").filter{ids.contains(caption($0,"id"))},id:\.labFileID){row in
                    NavigationLink {LabReview(journal:journal,owner:owner,file:row)} label:{
                        VStack(alignment:.leading){Text(caption(row,"name"));Text(row["lab"]==nil || row["labDraft"] != nil ? "Открыть для сверки":"Результаты сохранены").font(.caption)}
                    }
                }
            }}
            if importing {ProgressView("Сохранение оригиналов…")}
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
        }.navigationTitle("Новые бланки")
        .fileImporter(isPresented:$picker,allowedContentTypes:[.pdf,.image,.plainText],allowsMultipleSelection:true){result in
            guard case .success(let urls)=result else {
                if case .failure(let e)=result,(e as NSError).code != NSUserCancelledError {error=e.localizedDescription}
                return
            }
            acceptFiles(urls)
        }
        .sheet(isPresented:$camera){NativeCamera{data in
            do {try save([NativeUpload(name:"Фото бланка.jpg",mime:"image/jpeg",bytes:data)])}catch{self.error=error.localizedDescription}
        }}
        .onChange(of:photos){_,items in
            guard !items.isEmpty else{return}
            Task {
                importing=true;defer{importing=false;photos=[]}
                do {
                    var uploads=[NativeUpload]()
                    for item in items {
                        guard let data=try await item.loadTransferable(type:Data.self) else {throw JournalError("Не удалось прочитать выбранное фото.")}
                        let type=item.supportedContentTypes.first
                        uploads.append(NativeUpload(name:"Фото бланка."+(type?.preferredFilenameExtension ?? "jpg"),mime:type?.preferredMIMEType ?? "image/jpeg",bytes:data))
                    }
                    try save(uploads)
                } catch {self.error=error.localizedDescription}
            }
        }
    }
    private func acceptFiles(_ urls:[URL]) {
        do {try save(urls.map {url in
            NativeUpload(name:url.lastPathComponent,mime:UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",bytes:try readNativeFile(url))
        })}catch {self.error=error.localizedDescription}
    }
    private func save(_ uploads:[NativeUpload]) throws {
        let selected=try journal.addLabOriginals(owner:owner,uploads:uploads)
        for id in selected where !ids.contains(id){ids.append(id)}
        error=""
    }
}

private extension Dictionary where Key==String, Value==Any {
    var labFileID:String {self["id"] as? String ?? ""}
}

struct LabReview:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,id:String,fileName:String
    @Environment(\.dismiss) private var dismiss
    @State private var duplicate:DuplicateClinicalCard?
    @State private var lab:LabResult
    @State private var baseline:JournalObject
    @State private var reviewed=false
    @State private var reading=false
    @State private var notice=""
    @State private var busySaving=false
    @State private var validation=JournalFormValidation()

    init(journal:DeviceJournal,owner:String,file:JournalObject){
        self.journal=journal;self.owner=owner;id=caption(file,"id");fileName=caption(file,"name")
        _baseline=State(initialValue:file)
        _lab=State(initialValue:LabResult.from((file["labDraft"] ?? file["lab"]) as? JournalObject ?? [:]))
    }
    var body:some View {
        let issues=lab.validationIssues+(reviewed ? [] : [JournalFieldIssue(field:"lab-review",message:"Подтвердите сверку с оригиналом.")])
        let visible=validation.visible(issues)
        Form {
            Section("Оригинал"){
                NavigationLink(fileName){DeviceAttachment(journal:journal,owner:owner,id:id,name:fileName)}
                if !caption(baseline,"labRaw").isEmpty {DisclosureGroup("Распознанный текст"){Text(caption(baseline,"labRaw")).textSelection(.enabled)}}
                ForEach(entries(baseline,"issues").indices,id:\.self){i in Text(caption(entries(baseline,"issues")[i],"text"))}
                if reading {ProgressView("Читаем бланк на устройстве…")}
            }
            if journal.editable {
                LabFields(lab:$lab,issues:visible).disabled(reading)
                Section {
                    Toggle("Сверено с оригиналом",isOn:$reviewed).journalField("lab-review",visible)
                    Button("Сохранить результаты"){if validation.submit(issues),persist(final:true){dismiss()}}
                    Button("Уточнить позже"){if persist(final:false){dismiss()}}
                }.disabled(reading || journal.busy)
            }
            if !notice.isEmpty {Text(notice)}
            let match=duplicate?.id ?? caption(baseline,"duplicateLab")
            if !match.isEmpty,entries(journal.profile(owner),"files").contains(where:{caption($0,"id")==match && $0["lab"] != nil}){
                NavigationLink("Открыть существующий анализ"){LabReport(journal:journal,owner:owner,id:match)}
            }
        }.journalValidation(validation).navigationTitle("Сверка бланка")
        .onChange(of:lab){_,new in
            reviewed=false
            let saved=(baseline["labDraft"] ?? baseline["lab"]) as? JournalObject ?? [:]
            if !NSDictionary(dictionary:new.json).isEqual(to:saved) { _=persist(final:false) }
        }
        .task {if journal.editable, baseline["labDraft"]==nil,baseline["lab"]==nil {await recognize()}}
    }
    @MainActor private func recognize() async {
        reading=true;defer{reading=false}
        do {
            let original=try await journal.attachment(owner:owner,id:id)
            let result=try await Task.detached{try ClinicalOCR.read(original.bytes,mime:original.type,pdfRows:true)}.value
            try Task.checkCancellation()
            lab=try ClinicalImport().parseLab(text:result.text,name:fileName,issues:result.uncertainLines)
            let issues=result.uncertainLines+result.warnings.map{["text":$0]}
            _=persist(final:false,raw:result.text,issues:issues)
        } catch is CancellationError {} catch {
            notice="Не удалось распознать бланк. Можно заполнить поля по оригиналу. "+error.localizedDescription
        }
    }
    @discardableResult private func persist(final:Bool,raw:String?=nil,issues:[JournalObject]=[]) -> Bool {
        guard !busySaving, !final || (reviewed && lab.verified) else{return false}
        busySaving=true;defer{busySaving=false}
        do {
            var saved=baseline
            try journal.changeProfile(owner){profile in
                var files=entries(profile,"files")
                guard let i=files.firstIndex(where:{caption($0,"id")==id}) else{throw JournalError("Бланк недоступен.")}
                for key in ["lab","labDraft"] {
                    let before=baseline[key] as? JournalObject ?? [:],now=files[i][key] as? JournalObject ?? [:]
                    guard NSDictionary(dictionary:before).isEqual(to:now) else {throw JournalError("Бланк изменился. Откройте актуальную версию перед сохранением.")}
                }
                if let raw {files[i]["labRaw"]=raw;files[i]["issues"]=issues}
                if final {
                    let key=ClinicalDuplicates.lab(lab.json)
                    if (files[i]["lab"] as? JournalObject).map(ClinicalDuplicates.lab) != key,
                       let match=files.first(where:{row in
                           caption(row,"id") != id && (row["lab"] as? JournalObject).map(ClinicalDuplicates.lab)==key
                       }) {throw DuplicateClinicalCard(id:caption(match,"id"))}
                    files[i]["lab"]=lab.json;files[i].removeValue(forKey:"labDraft");files[i].removeValue(forKey:"duplicateLab")
                }
                else {files[i]["labDraft"]=(files[i]["labDraft"] as? JournalObject ?? [:]).merging(lab.json){_,new in new}}
                saved=files[i];profile["files"]=files
            }
            baseline=saved;notice="";duplicate=nil;return true
        } catch {notice=error.localizedDescription;duplicate=error as? DuplicateClinicalCard;return false}
    }
}

struct LabReport:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,id:String
    var body:some View {
        let file=entries(journal.profile(owner),"files").first{caption($0,"id")==id} ?? [:]
        let lab=file["lab"] as? JournalObject ?? [:]
        List {
            Section("Бланк"){
                LabeledContent("Дата взятия",value:caption(lab,"date"))
                if !caption(lab,"laboratory").isEmpty {LabeledContent("Лаборатория",value:caption(lab,"laboratory"))}
                NavigationLink("Исходный бланк"){DeviceAttachment(journal:journal,owner:owner,id:id,name:caption(file,"name"))}
            }
            NativeRecordTags(journal:journal,owner:owner,kind:.lab,id:id)
            Section("Показатели"){
                let rows=entries(lab,"rows")
                ForEach(rows.indices,id:\.self){i in
                    let row=rows[i]
                    VStack(alignment:.leading){
                        Text(caption(row,"name"));Text([caption(row,"value"),caption(row,"unit")].filter{!$0.isEmpty}.joined(separator:" ")).bold()
                        if !caption(row,"range").isEmpty{Text("Диапазон по бланку · "+caption(row,"range")).font(.caption)}
                        if !caption(row,"specimen").isEmpty{Text(caption(row,"specimen")).font(.caption)}
                    }
                }
            }
            if journal.editable {NavigationLink("Исправить результаты"){LabReview(journal:journal,owner:owner,file:file)}}
        }.navigationTitle(caption(lab,"name"))
    }
}
