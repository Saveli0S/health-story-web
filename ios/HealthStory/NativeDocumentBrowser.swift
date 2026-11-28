import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct NativeDocumentBrowser: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String
    @State private var search = ""
    @State private var category = ""

    var body: some View {
        let profile = journal.profile(owner)
        let tags = RecordTags(profile: profile, library: entries(journal.data, "tags"))
        let files = entries(profile, "files").filter { $0["examDraft"] == nil }
        let categories = Set(files.map { caption($0, "category") }.filter { !$0.isEmpty })
        let apiCategories = Set(["Назначения", "Лаборатория", "Снимки", "Заключения", "Рекомендации", "Другое"])
        let matches = files.filter { file in
            let group = caption(file, "category")
            let kind = file["lab"] != nil || group == "Лаборатория" ? "lab:" : "file:"
            return (category.isEmpty || category == group) && tags.matches(search, key: kind + caption(file, "id"),
                fields: [caption(file, "name"), group])
        }
        List {
            Picker("Категория", selection: $category) {
                Text("Все").tag("")
                ForEach(categories.union(apiCategories).sorted(), id: \.self) { Text($0).tag($0) }
            }
            if journal.editable {
                NavigationLink("Прикрепить файл") { NativeProfileUpload(journal: journal, owner: owner) }
            }
            if matches.isEmpty { Text("Документы не найдены").foregroundStyle(.secondary) }
            ForEach(matches, id: \.documentID) { file in
                NavigationLink {
                    NativeDocumentDetail(journal: journal, owner: owner, id: caption(file, "id"))
                } label: { NativeDocumentLabel(file: file) }
            }
        }.journalBackground().navigationTitle("Документы")
            .searchable(text: $search, prompt: "Название документа или тег")
    }
}

private struct NativeProfileUpload: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String
    @Environment(\.dismiss) private var dismiss
    @State private var choosing = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var uploads: [NativeUpload] = []
    @State private var visit = ""
    @State private var category = "Другое"
    @State private var date = Date()
    @State private var error = ""
    @State private var reading = false

    var body: some View {
        let visits = NativeTreatments.visits(journal.profile(owner))
        Form {
            NavigationLink("Загрузить лабораторный бланк") { LabIntake(journal: journal, owner: owner) }
            Picker("Категория", selection: $category) {
                ForEach(["Назначения", "Снимки", "Заключения", "Рекомендации", "Другое"], id: \.self) { Text($0) }
            }
            Picker("Визит", selection: $visit) {
                Text("Без привязки").tag("")
                ForEach(visits.indices, id: \.self) { i in
                    Text([NativeTreatments.field(visits[i], 2),NativeTreatments.field(visits[i], 1)].filter{!$0.isEmpty}.joined(separator:" · "))
                        .tag(NativeTreatments.field(visits[i], 0))
                }
            }
            DatePicker("Дата документа", selection: $date, in: ...Date(), displayedComponents: .date)
            Button("Выбрать файлы") { choosing = true }
            PhotosPicker("Выбрать фотографии", selection: $photos, matching: .images)
            ForEach(uploads) { file in
                NavigationLink(file.name) {
                    AttachmentView(original: .init(id: file.id, type: file.mime, bytes: file.bytes), name: file.name)
                }
            }.onDelete { uploads.remove(atOffsets: $0) }
            if !uploads.isEmpty { Button("Сохранить вложения") { save() } }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.disabled(reading || !journal.editable || journal.busy)
            .journalBackground().navigationTitle("Прикрепить файл")
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
                do {
                    let items = try result.get().map { url in
                        NativeUpload(name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ??
                            "application/octet-stream", bytes: try readNativeFile(url))
                    }
                    uploads += items
                } catch { self.error = error.localizedDescription }
            }
            .onChange(of: photos) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    reading = true
                    defer { reading = false; photos = [] }
                    do {
                        for item in items {
                            guard let data = try await item.loadTransferable(type: Data.self) else { throw JournalError("Фото недоступно.") }
                            let type = item.supportedContentTypes.first ?? .jpeg
                            uploads.append(NativeUpload(name: "Фото " + String(uploads.count + 1) + "." + (type.preferredFilenameExtension ?? "jpg"),
                                                        mime: type.preferredMIMEType ?? "image/jpeg", bytes: data))
                        }
                    } catch { self.error = error.localizedDescription }
                }
            }
    }

    private func save() {
        do {
            let profile = journal.profile(owner)
            guard visit.isEmpty || NativeTreatments.visits(profile).contains(where: { NativeTreatments.field($0, 0) == visit }) else {
                throw JournalError("Визит больше недоступен.")
            }
            if visit.isEmpty && ["Назначения", "Рекомендации"].contains(category) {
                throw JournalError("Выберите визит для назначения или рекомендаций.")
            }
            var records: [JournalObject] = [], originals: [NativeUpload] = []
            let known = entries(profile, "files").filter { caption($0, "visit") == visit }
            for file in uploads {
                let digest = ClinicalDuplicates.digest(file.bytes)
                if journal.matchingOriginal(owner: owner, file: file, digest: digest, rows: known + records) != nil { continue }
                var row: JournalObject = ["id": file.id, "name": file.name, "type": file.mime, "category": category,
                                          "date": dayString(date), "visit": visit, "sourceDigest": digest]
                if ["Назначения", "Рекомендации", "Заключения"].contains(category), !visit.isEmpty {
                    row["intake"] = true; row["checked"] = false
                }
                records.append(row); originals.append(file)
            }
            guard !records.isEmpty else { throw JournalError("Выбранные оригиналы уже сохранены.") }
            try journal.changeProfile(owner, originals: originals) { profile in
                profile["files"] = entries(profile, "files") + records
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

private struct NativeDocumentDetail: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, id: String
    @State private var editing = false

    var body: some View {
        let profile = journal.profile(owner)
        let files = entries(profile, "files")
        let file = files.first { caption($0, "id") == id } ?? [:]
        let name = caption(file, "name"), category = caption(file, "category")
        let links = entries(profile, "docLinks").filter { caption($0, "id") == id || caption($0, "other") == id }
        let linkedIDs = Set(links.map { caption($0, "id") == id ? caption($0, "other") : caption($0, "id") })
        List {
            if file.isEmpty { Text("Документ больше недоступен.") }
            else {
                NativeFileLink(journal: journal, owner: owner, file: file)
                if !caption(file, "clinicalText").isEmpty {
                    Section("Текст заключения для разбора") { Text(caption(file, "clinicalText")) }
                }
                if !linkedIDs.isEmpty {
                    Section("Связанные документы") {
                        ForEach(files.filter { linkedIDs.contains(caption($0, "id")) }, id: \.documentID) { other in
                            NavigationLink {
                                NativeDocumentDetail(journal: journal, owner: owner, id: caption(other, "id"))
                            } label: { NativeDocumentLabel(file: other) }
                        }
                    }
                }
                if journal.editable && ["Снимки", "Заключения"].contains(category) {
                    Button("Связать снимок и заключение") { editing = true }.disabled(journal.busy)
                }
                ExamLinks(journal: journal, owner: owner, rows: entries(profile, "exams").filter {
                    entries($0, "attachments").contains { caption($0, "id") == id }
                })
            }
        }.journalBackground().navigationTitle(name.isEmpty ? "Документ" : name)
            .sheet(isPresented: $editing) {
                NavigationStack { NativeDocumentLinkEditor(journal: journal, owner: owner, file: file, initial: linkedIDs.sorted().first ?? "") }
            }
    }
}

private struct NativeDocumentLinkEditor: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, file: JournalObject
    @Environment(\.dismiss) private var dismiss
    @State private var related: String
    @State private var error = ""

    init(journal: DeviceJournal, owner: String, file: JournalObject, initial: String) {
        self.journal = journal
        self.owner = owner
        self.file = file
        _related = State(initialValue: initial)
    }

    var body: some View {
        Form {
            Picker("Документ этого визита", selection: $related) {
                Text("Без связи").tag("")
                ForEach(options(journal.profile(owner)), id: \.documentID) { Text(caption($0, "name")).tag(caption($0, "id")) }
            }
            Button("Сохранить связь") {
                do {
                    let id = caption(file, "id")
                    try journal.changeProfile(owner) { profile in
                        guard entries(profile, "files").contains(where: { caption($0, "id") == id }),
                            related.isEmpty || options(profile).contains(where: { caption($0, "id") == related }) else {
                            throw JournalError("Документ больше недоступен.")
                        }
                        var links = entries(profile, "docLinks").filter { caption($0, "id") != id && caption($0, "other") != id }
                        if !related.isEmpty { links.append(["id": id, "other": related]) }
                        profile["docLinks"] = links
                    }
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }.disabled(!journal.editable || journal.busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Связанные документы")
    }

    private func options(_ profile: JournalObject) -> [JournalObject] {
        let desired = caption(file, "category") == "Снимки" ? "Заключения" : "Снимки"
        return entries(profile, "files").filter {
            caption($0, "category") == desired && caption($0, "visit") == caption(file, "visit") && $0["examDraft"] == nil
        }
    }
}

private extension Dictionary where Key == String, Value == Any {
    var documentID: String { caption(self, "id") }
}
