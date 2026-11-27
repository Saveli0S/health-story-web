import Foundation

enum VisitDrafts {
    static func group(in profile:JournalObject,id:String) -> [JournalObject] {
        let list=entries(profile,"visitDrafts")
        guard let main=list.first(where:{caption($0,"id")==id && caption($0,"parent").isEmpty}) else{return []}
        return [main]+list.filter{caption($0,"parent")==id}
    }
    static func check(_ profile:JournalObject,id:String,expected:[JournalObject]) throws {
        guard NSArray(array:group(in:profile,id:id)).isEqual(to:expected) else {
            throw JournalError("Черновик был изменён на другом устройстве. Откройте его заново.")
        }
    }
    static func fields(_ draft:NativeVisitDraft) -> JournalObject {
        ["episode":draft.episodeID ?? "new","episodeName":draft.episode,"title":draft.title,"date":dayString(draft.date),
         "doctor":"new","doctorName":draft.doctor,"specialty":draft.specialty,"clinic":draft.clinic,"note":draft.note,"recommendation":draft.recommendation]
    }
    static func medicines(_ draft:NativeVisitDraft) -> [JournalObject] {
        draft.medicines.map{["id":$0.id,"name":$0.name,"strength":$0.strength,"form":$0.form,"instructions":$0.instructions]}
    }

    static func documents(_ draft:NativeVisitDraft, previous:[JournalObject]) -> [JournalObject] {
        guard let root=draft.files.first?.id else{return []}
        return draft.files.map { file in
            var row=previous.first{caption($0,"id")==file.id} ?? [:]
            row["id"]=file.id;row["name"]=file.name;row["type"]=file.mime;row["kind"]=file.category
            row["size"]=file.bytes.count;row["date"]=row["date"] ?? dayString()
            row["episode"]=draft.episodeID ?? "";row["parent"]=file.id==root ? nil:root
            row["raw"]=file.raw;row["issues"]=file.issues;row["warnings"]=file.warnings
            row["transcription"]=file.transcription
            row["readCategory"]=file.readCategory;row["readError"]=file.warnings.joined(separator:"\n")
            row["state"]=file.readCategory != nil ? "read" : row["state"] ?? "queued"
            if let lab=file.lab {row["labDraft"]=lab.json}
            if file.id==root {
                row["fields"]=fields(draft);row["manualMeds"]=medicines(draft);row["recognizedDate"]=draft.recognizedDate
            }
            return row
        }
    }
    static func restore(_ rows:[JournalObject],profile:JournalObject,originals:[String:Data]) throws -> NativeVisitDraft {
        guard let main=rows.first else {throw JournalError("Черновик уже обработан.")}
        let mainHeader=(rows.first{!caption($0["header"] as? JournalObject ?? [:],"title").isEmpty} ?? main)["header"] as? JournalObject ?? [:]
        let fields=mainHeader.merging(main["fields"] as? JournalObject ?? [:]){_,new in new}
        var draft=NativeVisitDraft()
        draft.title=caption(fields,"title");draft.note=caption(fields,"note");draft.clinic=caption(fields,"clinic")
        draft.doctor=caption(fields,"doctorName");draft.specialty=caption(fields,"specialty");draft.recommendation=caption(fields,"recommendation")
        let selected=caption(fields,"doctor")
        if !selected.isEmpty,selected != "new",let values=entries(profile,"addedDoctors").first(where:{caption($0,"id")==selected})?["values"] as? [String],values.count>1 {
            draft.doctor=values[0];draft.specialty=values[1]
            if draft.clinic.isEmpty && values.count>2 {draft.clinic=values[2]}
        }
        let episode=fields["episode"] as? String ?? caption(main,"episode")
        draft.episodeID=episode.isEmpty || episode=="new" ? nil:episode
        draft.episode=entries(profile,"episodes").first{caption($0,"id")==draft.episodeID}?["name"] as? String ?? caption(fields,"episodeName")
        let fmt=DateFormatter();fmt.locale=Locale(identifier:"en_US_POSIX");fmt.dateFormat="yyyy-MM-dd";fmt.isLenient=false
        if let date=fmt.date(from:caption(fields,"date")){draft.date=date;draft.recognizedDate=main["recognizedDate"] as? Bool ?? true}
        draft.medicines=(main["manualMeds"] as? [JournalObject] ?? rows.flatMap{entries($0,"proposed")}).map{
            NativeMedicine(id:$0["id"] as? String ?? UUID().uuidString,name:caption($0,"name"),strength:caption($0,"strength"),form:caption($0,"form"),instructions:caption($0,"instructions"))
        }
        for row in rows {
            let id=caption(row,"id")
            guard let bytes=originals[id] else {throw JournalError("Для продолжения загрузите оригиналы черновика.")}
            var file=NativeUpload(id:id,category:row["kind"] as? String ?? "Назначения",name:caption(row,"name"),mime:caption(row,"type"),bytes:bytes)
            file.raw=caption(row,"raw");file.transcription=row["transcription"] as? String;file.issues=entries(row,"issues")
            file.warnings=row["warnings"] as? [String] ?? [caption(row,"readError")].filter{!$0.isEmpty}
            file.readCategory=row["readCategory"] as? String ?? (caption(row,"state")=="read" ? file.category:nil)
            if let lab=row["labDraft"] as? JournalObject{file.lab=LabResult.from(lab)}
            else if file.category=="Лаборатория",!file.raw.isEmpty{file.lab=try ClinicalImport().parseLab(text:file.raw,name:file.name,issues:file.issues)}
            draft.files.append(file)
        }
        return draft
    }
}
