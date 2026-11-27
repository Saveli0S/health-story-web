import SwiftUI
import JavaScriptCore
import UniformTypeIdentifiers

struct ParsedLabRow:Identifiable, Equatable {
    var id=UUID(), name="",value="",unit="",range="",specimen=""
    var json:JournalObject {["name":name.trim,"value":value.trim,"unit":unit.trim,"range":range.trim,"specimen":specimen.trim]}
    func field(_ name:String) -> String {"lab-\(id)-\(name)"}
    var validationIssues:[JournalFieldIssue] {
        let numeric=value.range(of:"^[<>≤≥+−-]?\\s*\\d",options:.regularExpression) != nil
        return [
            ("name",name,"название показателя","Укажите название показателя."),
            ("value",value,"результат","Укажите результат."),
            ("unit",unit,"единицу измерения",numeric ? "Укажите единицу измерения." : ""),
            ("range",range,"референсный диапазон","")
        ].compactMap { key,input,label,required in
            if input.range(of:"[?？�]|неразборчив|уточнить",options:[.regularExpression,.caseInsensitive]) != nil {
                return JournalFieldIssue(field:field(key),message:"Уточните \(label) по оригиналу.")
            }
            return required.isEmpty ? nil : .required(field(key),input,required)
        }
    }
}
struct LabResult:Equatable {
    var name="",date="",laboratory="",category="Другое",rows:[ParsedLabRow]=[]
    var json:JournalObject {["name":name.trim,"date":date,"laboratory":laboratory.trim,"category":category,"rows":rows.map(\.json)]}
    static func from(_ data:JournalObject) -> LabResult {
        var result=LabResult()
        result.name=caption(data,"name"); result.date=caption(data,"date")
        result.laboratory=caption(data,"laboratory")
        result.category=data["category"] as? String ?? "Другое"
        result.rows=entries(data,"rows").map { r in
            ParsedLabRow(name:caption(r,"name"),value:caption(r,"value"),unit:caption(r,"unit"),range:caption(r,"range"),specimen:caption(r,"specimen"))
        }
        return result
    }
    var validationIssues:[JournalFieldIssue] {
        [
            .required("lab-name",name,"Укажите название исследования."),
            CoursePeriod.date(date)==nil || date>dayString() ?
                JournalFieldIssue(field:"lab-date",message:"Укажите дату взятия образца в формате ГГГГ-ММ-ДД, не позже сегодняшнего дня.") : nil,
            rows.isEmpty ? JournalFieldIssue(field:"lab-add-row",message:"Добавьте показатель и его результат.") : nil
        ].compactMap{$0}+rows.flatMap(\.validationIssues)
    }
    var verified:Bool {validationIssues.isEmpty}
}
struct ClinicalImport {
    let js:JSContext
    init(bundle:Bundle = .main) throws {
        guard let ctx=JSContext() else {throw JournalError("Не удалось начать обработку документов.")}
        js=ctx;ctx.evaluateScript("let uid=()=>String(Math.random());let todayLocal=()=>new Date().toLocaleDateString('sv-SE')")
        for resource in ["clinical-parser","privacy"] {
            guard let url=bundle.url(forResource:resource,withExtension:"js") else {throw JournalError("Отсутствует модуль "+resource)}
            ctx.evaluateScript(try String(contentsOf:url,encoding:.utf8))
            if ctx.exception != nil {throw JournalError("Не удалось загрузить модуль "+resource)}
        }
    }
    func redact(_ text:String,names:[String]) throws -> String {
        guard let method=js.objectForKeyedSubscript("anonymizeClinicalText"),!method.isUndefined,
              let result=method.call(withArguments:[text,names]),!result.isUndefined,let clean=result.toString(),js.exception==nil
        else {throw JournalError("Не удалось обезличить данные.")}
        return clean
    }
    func redact(_ text:String,names:[String],clinics:[String],files:[String]) throws -> String {
        guard let method=js.objectForKeyedSubscript("redactClinicalLabels"),!method.isUndefined,
              let value=method.call(withArguments:[text,clinics,files]),!value.isUndefined,
              let masked=value.toString(),js.exception==nil else {
            throw JournalError("Не удалось обезличить данные.")
        }
        return try redact(masked,names:names)
    }
    func seriesPoint(_ row:JournalObject, title:String, source:String) -> JournalObject? {
        guard let fn=js.objectForKeyedSubscript("labSeriesPoint"), !fn.isUndefined else {return nil}
        return fn.call(withArguments:[row,title,source])?.toDictionary() as? JournalObject
    }
    func parseLab(text:String,name:String,issues:[JournalObject]) -> LabResult {
        let info=js.objectForKeyedSubscript("parseLabText")?.call(withArguments:[text,name,issues])?.toDictionary() as? JournalObject ?? [:]
        return LabResult.from(info)
    }
    func apply(text:String,issues:[[String:Any]]=[],upload:inout NativeUpload,draft:inout NativeVisitDraft) {
        upload.raw=text
        if upload.category=="Назначения" {
            let header=js.objectForKeyedSubscript("parseVisitHeader")?.call(withArguments:[text])?.toDictionary() as? JournalObject ?? [:]
            if draft.title.isEmpty {draft.title=caption(header,"title")}
            if draft.episode.isEmpty {draft.episode=caption(header,"episodeName")}
            if draft.doctor.isEmpty {draft.doctor=caption(header,"doctorName")}
            if draft.specialty.isEmpty {draft.specialty=caption(header,"specialty")}
            if draft.clinic.isEmpty {draft.clinic=caption(header,"clinic")}
            if draft.note.isEmpty {draft.note=caption(header,"note")}
            let fmt=DateFormatter();fmt.locale=Locale(identifier:"en_US_POSIX");fmt.dateFormat="yyyy-MM-dd"
            if let d=fmt.date(from:caption(header,"date")) {if !draft.recognizedDate {draft.date=d;draft.recognizedDate=true}}
        }
        if upload.category=="Лаборатория" {
            upload.lab=parseLab(text:text,name:upload.name,issues:issues)
        } else if upload.category=="Назначения" || upload.category=="Рекомендации" {
            let textRec=js.objectForKeyedSubscript("recommendationText")?.call(withArguments:[text])?.toString() ?? ""
            if !textRec.trim.isEmpty {draft.recommendation = [draft.recommendation,textRec].filter{!$0.isEmpty}.joined(separator:"\n");upload.hasRecommendation=true}
            if upload.category=="Назначения" {
                let meds=js.objectForKeyedSubscript("proposedMedicines")?.call(withArguments:[text,issues])?.toArray() as? [JournalObject] ?? []
                draft.medicines += meds.map{NativeMedicine(name:caption($0,"name"),strength:caption($0,"strength"),form:caption($0,"form"),instructions:caption($0,"instructions"))}
            }
        }
    }
}
struct LabFields:View {
    @Binding var lab:LabResult
    var issues:[JournalFieldIssue]=[]
    var body:some View {
        Group {
            Section("Сведения из бланка"){
                TextField("Название",text:$lab.name).journalField("lab-name",issues)
                TextField("Дата взятия · ГГГГ-ММ-ДД",text:$lab.date).journalField("lab-date",issues)
                TextField("Лаборатория",text:$lab.laboratory)
                Picker("Категория",selection:$lab.category){ForEach(Array(Set(["Другое","Гематология","Биохимия",lab.category])).sorted(),id:\.self){Text($0).tag($0)}}
            }
            Section("Показатели"){
                ForEach($lab.rows){$r in VStack(alignment:.leading){
                    TextField("Показатель",text:$r.name).journalField(r.field("name"),issues)
                    TextField("Значение",text:$r.value).journalField(r.field("value"),issues)
                    TextField("Единица",text:$r.unit).journalField(r.field("unit"),issues)
                    TextField("Референсный диапазон",text:$r.range).journalField(r.field("range"),issues)
                    TextField("Биоматериал",text:$r.specimen)
                }}
                .onDelete{lab.rows.remove(atOffsets:$0)}
                Button("Добавить показатель"){lab.rows.append(ParsedLabRow())}.journalField("lab-add-row",issues)
            }
        }
    }
}
struct LabEditor:View {
    @Binding var lab:LabResult
    var body:some View {Form {LabFields(lab:$lab)}.navigationTitle("Сверка бланка")}
}
struct NativeCamera:UIViewControllerRepresentable {
    var receive:(Data)->Void
    @Environment(\.dismiss) var dismiss
    func makeCoordinator()->Coordinator {Coordinator(self)}
    func makeUIViewController(context:Context)->UIImagePickerController {
        let picker=UIImagePickerController();picker.sourceType = .camera;picker.delegate=context.coordinator;return picker
    }
    func updateUIViewController(_ uiViewController:UIImagePickerController,context:Context){}
    final class Coordinator:NSObject,UIImagePickerControllerDelegate,UINavigationControllerDelegate {
        let parent:NativeCamera
        init(_ parent:NativeCamera){self.parent=parent}
        func imagePickerControllerDidCancel(_ picker:UIImagePickerController){parent.dismiss()}
        func imagePickerController(_ picker:UIImagePickerController,didFinishPickingMediaWithInfo info:[UIImagePickerController.InfoKey:Any]){
            if let img=info[.originalImage] as? UIImage,let bytes=img.jpegData(compressionQuality:0.88){parent.receive(bytes)}
            parent.dismiss()
        }
    }
}
