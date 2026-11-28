import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct VisitAttachmentIntake: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,visit:String
    @State private var uploads=[NativeUpload]()
    @State private var picker=false
    @State private var camera=false
    @State private var photos=[PhotosPickerItem]()
    @State private var ids=Set<String>()
    @State private var error=""

    var body:some View {
        Form {
            Section("Добавить к этому визиту"){
                Button("Выбрать файлы"){picker=true}
                PhotosPicker("Из фото",selection:$photos,matching:.images)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {Button("Снять документ"){camera=true}}
            }.disabled(journal.busy || !journal.editable)
            if !uploads.isEmpty {
                Section("Категория и оригинал"){
                    ForEach($uploads){$file in
                        Picker(file.name,selection:$file.category){
                            ForEach(["Назначения","Рекомендации","Лаборатория","Снимки","Заключения","Другое"],id:\.self){Text($0)}
                        }
                        NavigationLink("Оригинал · "+file.name){
                            AttachmentView(original:.init(id:file.id,type:file.mime,bytes:file.bytes),name:file.name)
                        }
                    }.onDelete{uploads.remove(atOffsets:$0)}
                    Button("Прикрепить к визиту"){save()}.disabled(journal.busy || !journal.editable)
                }
            }
            if !ids.isEmpty {
                Section("Сохранено"){
                    VisitAttachmentLinks(journal:journal,owner:owner,rows:entries(journal.profile(owner),"files").filter{ids.contains(caption($0,"id"))})
                }
            }
            if !error.isEmpty {Text(error)}
        }.navigationTitle("Вложения визита")
        .fileImporter(isPresented:$picker,allowedContentTypes:[.data],allowsMultipleSelection:true){result in
            do {uploads += try result.get().map{url in
                NativeUpload(category:"Другое",name:url.lastPathComponent,
                    mime:UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                    bytes:try readNativeFile(url))
            }} catch {if (error as NSError).code != NSUserCancelledError {self.error=error.localizedDescription}}
        }
        .fullScreenCover(isPresented:$camera){NativeCamera{bytes in
            uploads.append(NativeUpload(category:"Другое",name:"Фото документа.jpg",mime:"image/jpeg",bytes:bytes))
        }.ignoresSafeArea()}
        .onChange(of:photos){_,items in
            guard !items.isEmpty else{return}
            Task {
                defer{photos=[]}
                do {
                    for item in items {
                        guard let bytes=try await item.loadTransferable(type:Data.self) else {throw JournalError("Не удалось прочитать фото.")}
                        let type=item.supportedContentTypes.first
                        uploads.append(NativeUpload(category:"Другое",name:"Фото документа."+(type?.preferredFilenameExtension ?? "jpg"),
                                                    mime:type?.preferredMIMEType ?? "image/jpeg",bytes:bytes))
                    }
                }catch{self.error=error.localizedDescription}
            }
        }
    }

    private func save(){
        do {
            ids.formUnion(try journal.addVisitAttachments(owner:owner,visit:visit,uploads:uploads))
            uploads=[];error=""
        }catch{self.error=error.localizedDescription}
    }
}

extension DeviceJournal {
    func addVisitAttachments(owner:String,visit:String,uploads:[NativeUpload])throws->[String] {
        guard editable,!busy,NativeTreatments.visits(profile(owner)).contains(where:{NativeTreatments.field($0,0)==visit}) else {
            throw JournalError("Визит недоступен для изменения.")
        }
        let known=entries(profile(owner),"files").filter{caption($0,"visit")==visit}
        var ids=[String](),added=[NativeUpload](),rows=[JournalObject]()
        for file in uploads {
            let digest=ClinicalDuplicates.digest(file.bytes)
            if let same=matchingOriginal(owner:owner,file:file,digest:digest,rows:known+rows) {
                ids.append(caption(same,"id"));continue
            }
            var row:JournalObject=["id":file.id,"name":file.name,"type":file.mime,"category":file.category,
                                   "date":dayString(),"visit":visit,"sourceDigest":digest]
            if ["Назначения","Рекомендации","Заключения"].contains(file.category) {
                row["intake"]=true;row["checked"]=false
            }
            added.append(file);rows.append(row);ids.append(file.id)
        }
        if !rows.isEmpty {try changeProfile(owner,originals:added){$0["files"]=entries($0,"files")+rows}}
        return ids
    }
}

struct VisitAttachmentLinks: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,rows:[JournalObject]
    var body:some View {
        ForEach(rows.indices,id:\.self){i in
            let row=rows[i],name=caption(row,"name")
            NativeFileLink(journal:journal,owner:owner,file:row)
            if journal.editable && caption(row,"category")=="Лаборатория" {
                NavigationLink("Сверить показатели · "+name){LabReview(journal:journal,owner:owner,file:row)}
            } else if journal.editable && row["intake"] as? Bool==true {
                NavigationLink("Сверить сведения · "+name){VisitAttachmentReview(journal:journal,owner:owner,file:row)}
            }
        }
    }
}

private struct VisitAttachmentReview: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,file:JournalObject
    @Environment(\.dismiss) private var dismiss
    @State private var text:String
    @State private var reviewed=false
    @State private var reading=false
    @State private var error=""
    @State private var medicines=[NativeMedicine]()
    @State private var validation=JournalFormValidation()
    @State private var sourcePosition=NativeSourcePosition()

    init(journal:DeviceJournal,owner:String,file:JournalObject){
        self.journal=journal;self.owner=owner;self.file=file
        let category=caption(file,"category")
        let key=category=="Рекомендации" ? "recommendation":category=="Заключения" ? "clinicalText":"context"
        let draft=file["draft"] as? JournalObject ?? [:]
        _text=State(initialValue:draft[key] as? String ?? caption(file,key))
        let rows=draft["meds"] as? [JournalObject] ?? entries(file,"meds")
        _medicines=State(initialValue:rows.map{row in
            NativeMedicine(id:row["id"] as? String ?? UUID().uuidString,name:caption(row,"name"),strength:caption(row,"strength"),
                           form:caption(row,"form"),instructions:caption(row,"instructions"))
        })
    }
    var body:some View {
        let issues=medicines.flatMap(\.validationIssues)+(reviewed ? [] : [
            JournalFieldIssue(field:"attachment-review",message:"Подтвердите сверку с оригиналом.")
        ])
        let visible=validation.visible(issues)
        let id=caption(file,"id"),name=caption(file,"name")
        NativeSourceReview(sources:[NativeSourceItem(id:id,name:name)],position:$sourcePosition,
                           load:{try await journal.attachment(owner:owner,id:$0)}) {
        Form {
            NavigationLink("Открыть оригинал"){DeviceAttachment(journal:journal,owner:owner,id:caption(file,"id"),name:caption(file,"name"))}
            Button(reading ? "Распознаём…" : "Распознать на iPhone"){Task {await recognize()}}.disabled(reading || journal.busy)
            TextField("Сведения по оригиналу",text:$text,axis:.vertical).lineLimit(4...9).disabled(reading)
            if caption(file,"category")=="Назначения" {
                Section("Лекарства"){
                    ForEach($medicines){$medicine in
                        TextField("Название",text:$medicine.name).journalField(medicine.field("name"),visible)
                        TextField("Дозировка",text:$medicine.strength).journalField(medicine.field("strength"),visible)
                        TextField("Форма",text:$medicine.form)
                        TextField("Схема приёма",text:$medicine.instructions).journalField(medicine.field("instructions"),visible)
                    }.onDelete{medicines.remove(atOffsets:$0)}
                    Button("Добавить лекарство"){medicines.append(NativeMedicine())}
                }
            }
            if !error.isEmpty {Text(error)}
            Toggle("Сверено с оригиналом",isOn:$reviewed).journalField("attachment-review",visible)
            Button("Сохранить сведения"){if validation.submit(issues){save()}}.disabled(!journal.editable || journal.busy || reading)
        }.journalValidation(validation)
        }.navigationTitle("Сверка вложения")
    }

    private func recognize() async {
        reading=true;reviewed=false;error="";defer{reading=false}
        do {
            let original=try await journal.attachment(owner:owner,id:caption(file,"id"))
            let found=try await Task.detached{try ClinicalOCR.read(original.bytes,mime:original.type)}.value
            var draft=NativeVisitDraft()
            var source=NativeUpload(category:caption(file,"category"),name:caption(file,"name"),mime:original.type,bytes:original.bytes)
            try ClinicalImport().apply(text:found.text,issues:found.uncertainLines,upload:&source,draft:&draft)
            if !found.text.trim.isEmpty {
                text=draft.recommendation.trim.isEmpty ? found.text:draft.recommendation
                if medicines.isEmpty {medicines=draft.medicines}
            }
            if !found.uncertainLines.isEmpty {error="Некоторые строки неясны. Сверьте текст и дозировки с оригиналом."}
            else if found.text.trim.isEmpty {error="Текст не распознан. Можно заполнить сведения вручную."}
        }catch {self.error=error.localizedDescription}
    }

    private func save(){
        do {
            let drugs=try medicines.map{try $0.record()}
            try journal.changeProfile(owner){profile in
                var files=entries(profile,"files")
                guard let index=files.firstIndex(where:{caption($0,"id")==caption(file,"id")}),
                      try jsonBytes(files[index])==jsonBytes(file) else {
                    throw JournalError("Вложение изменилось. Откройте его повторно.")
                }
                let category=caption(file,"category")
                if category=="Рекомендации" {files[index]["recommendation"]=text.trim}
                else if category=="Заключения" {files[index]["clinicalText"]=text.trim}
                else {
                    let prior=entries(file,"meds")
                    files[index]["context"]=text.trim
                    files[index]["meds"]=drugs.map{drug in
                        var result=drug
                        if let same=prior.first(where:{caption($0,"id")==caption(drug,"id")}),let period=same["period"] {result["period"]=period}
                        return result
                    }
                }
                files[index].removeValue(forKey:"draft")
                files[index]["checked"]=true
                files[index]["lastConfirmed"]=ISO8601DateFormatter().string(from:Date())
                profile["files"]=files
            }
            dismiss()
        }catch {self.error=error.localizedDescription}
    }
}
