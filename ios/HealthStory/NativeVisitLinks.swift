import SwiftUI

enum NativeVisitLinks {
    struct Option: Identifiable {
        let kind: String, target: String, title: String, detail: String
        let record: JournalObject?
        var course: NativeCourse?
        let visit: String
        var source: String { course?.visit ?? "" }

        var id: String {
            let parts = [visit, kind, source, target]
            guard let bytes = try? JSONSerialization.data(withJSONObject: parts, options: .withoutEscapingSlashes) else { return "" }
            return String(decoding: bytes, as: UTF8.self)
        }
        var row: JournalObject {
            ["id": id, "visit": visit, "kind": kind, "source": source, "target": target]
        }
        var category: String {
            switch kind {
            case "lab": "Анализы"
            case "med": "Лекарства"
            default: "Документы"
            }
        }
    }

    static func options(_ visit: String, profile: JournalObject) -> [Option] {
        let files = entries(profile, "files").filter {
            caption($0, "visit") != visit && caption($0, "examDraft").isEmpty && !caption($0, "id").isEmpty
        }
        let labs = files.compactMap { file -> Option? in
            guard let lab = file["lab"] as? JournalObject else { return nil }
            return Option(kind: "lab", target: caption(file, "id"), title: caption(lab, "name"),
                          detail: caption(lab, "date"), record: file, visit: visit)
        }
        let documents = files.map {
            Option(kind: "file", target: caption($0, "id"), title: caption($0, "name"),
                   detail: caption($0, "category"), record: $0, visit: visit)
        }
        let prescriptions = NativeTreatments.all(profile).filter {
            $0.visit != visit && !caption($0.medicine, "id").isEmpty
        }.map {
            Option(kind: "med", target: caption($0.medicine, "id"), title: $0.title,
                   detail: $0.visitTitle + " · " + $0.date, record: nil, course: $0, visit: visit)
        }
        return labs + prescriptions + documents
    }

    static func displayed(_ visit: String, profile: JournalObject) -> [Option] {
        let linked = entries(profile, "visitLinks").filter { caption($0, "visit") == visit }
        return options(visit, profile: profile).filter { option in
            linked.contains { caption($0, "kind") == option.kind &&
                caption($0, "target") == option.target && caption($0, "source") == option.source }
        }
    }
}

struct NativeVisitLinkSection: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, visit: String

    var body: some View {
        let linked = NativeVisitLinks.displayed(visit, profile: journal.profile(owner))
        Section("Связанные записи") {
            ForEach(linked) { option in
                if option.kind == "lab" {
                    NavigationLink { LabReport(journal: journal, owner: owner, id: option.target) } label: { label(option) }
                } else if let course = option.course {
                    NavigationLink { NativeLinkedMedicine(journal: journal, owner: owner, course: course) } label: { label(option) }
                } else if let record = option.record {
                    NativeFileLink(journal: journal, owner: owner, file: record)
                }
            }
            if journal.editable {
                NavigationLink("Связанные записи") { NativeVisitLinksEditor(journal: journal, owner: owner, visit: visit) }
                    .disabled(journal.busy)
            }
        }
    }

    private func label(_ option: NativeVisitLinks.Option) -> some View {
        JournalRowLabel(title: option.title, symbol: option.kind == "lab" ? "testtube.2" : "pills", subtitle: option.detail)
    }
}

private struct NativeLinkedMedicine: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, course: NativeCourse
    var body: some View {
        List {
            Text(caption(course.medicine, "instructions"))
            Text(course.period.summary)
            Text(course.status)
            if let row = NativeTreatments.visits(journal.profile(owner)).first(where: { NativeTreatments.field($0, 0) == course.visit }) {
                NavigationLink(course.visitTitle) { NativeVisitDetails(journal: journal, owner: owner, row: row) }
            }
        }.journalBackground().navigationTitle(course.title)
    }
}

private struct NativeVisitLinksEditor: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, visit: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var selected: Set<String> = []
    @State private var baseline: Set<String>?
    @State private var error = ""

    var body: some View {
        let options = NativeVisitLinks.options(visit, profile: journal.profile(owner))
        let visible = options.filter {
            search.trim.isEmpty || ($0.title + " " + $0.detail).localizedCaseInsensitiveContains(search.trim)
        }
        Form {
            TextField("Найти запись", text: $search)
            Text("Выбрано: \(selected.count)").foregroundStyle(.secondary)
            if visible.isEmpty { Text(search.trim.isEmpty ? "Нет других записей для привязки." : "Совпадений нет.") }
            ForEach(["Анализы", "Лекарства", "Документы"], id: \.self) { group in
                let items = visible.filter { $0.category == group }
                if !items.isEmpty {
                    Section(group) {
                        ForEach(items) { option in
                            Toggle(isOn: Binding(get: { selected.contains(option.id) }, set: {
                                if $0 { selected.insert(option.id) } else { selected.remove(option.id) }
                            })) {
                                VStack(alignment: .leading) {
                                    Text(option.title)
                                    Text(option.detail).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            Button("Сохранить связи") { save() }.disabled(!journal.editable || journal.busy || baseline == nil)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }
        .task {
            if baseline == nil {
                let links = Set(NativeVisitLinks.displayed(visit, profile: journal.profile(owner)).map(\.id))
                selected = links
                baseline = links
            }
        }
        .journalBackground().navigationTitle("Связанные записи")
    }

    private func save() {
        guard let baseline else { return }
        do {
            try journal.changeProfile(owner) { profile in
                guard NativeTreatments.visits(profile).contains(where: { NativeTreatments.field($0, 0) == visit }) else {
                    throw JournalError("Визит больше недоступен.")
                }
                let available = NativeVisitLinks.options(visit, profile: profile)
                let added = selected.subtracting(baseline), removed = baseline.subtracting(selected)
                guard added.isSubset(of: Set(available.map(\.id))) else {
                    throw JournalError("Одна из записей уже недоступна. Откройте связи заново.")
                }
                let stored = entries(profile, "visitLinks").filter { !removed.contains(caption($0, "id")) }
                let existing = Set(stored.map { caption($0, "id") })
                profile["visitLinks"] = stored + available.filter { added.contains($0.id) && !existing.contains($0.id) }.map(\.row)
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeVisitSources: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, visit: String

    var body: some View {
        let profile = journal.profile(owner)
        let files = entries(profile, "files").filter { caption($0, "visit") == visit }
        List {
            NavigationLink("Назначения врача") { NativeTreatmentReview(journal: journal, owner: owner, visit: visit) }
            NativeVisitRecommendations(journal: journal, owner: owner, visit: visit)
            Section("Результаты обследований") {
                ExamLinks(journal: journal, owner: owner, rows: entries(profile, "exams").filter { caption($0, "visit") == visit })
            }
            Section("Вложения") {
                VisitAttachmentLinks(journal: journal, owner: owner, rows: files)
                if journal.editable {
                    NavigationLink("Прикрепить фото, PDF или другой файл") {
                        VisitAttachmentIntake(journal: journal, owner: owner, visit: visit)
                    }.disabled(journal.busy)
                }
            }
            NativeVisitLinkSection(journal: journal, owner: owner, visit: visit)
        }.journalBackground().navigationTitle("Назначение и вложения")
    }
}

@MainActor private enum NativeRecommendationChecklist {
    private static let parser = try? ClinicalImport()

    static func sources(_ profile: JournalObject, visit: String) -> [JournalObject] {
        let saved = entries(profile, "recommendations").filter { caption($0, "visit") == visit && !caption($0, "text").trim.isEmpty }
        let attached = entries(profile, "files").filter {
            caption($0, "visit") == visit && $0["checked"] as? Bool == true && !caption($0, "recommendation").trim.isEmpty
        }
        return saved.map { source($0, collection: "recommendations", text: "text", file: "source") }
            + attached.map { source($0, collection: "files", text: "recommendation", file: "id") }
    }

    private static func source(_ row: JournalObject, collection: String, text: String, file: String) -> JournalObject {
        ["collection": collection, "id": caption(row, "id"), "text": caption(row, text),
         "file": caption(row, file), "checks": row["recommendationChecks"] as? JournalObject ?? [:]]
    }

    static func groups(_ sources: [JournalObject]) -> [JournalObject] {
        parser?.js.objectForKeyedSubscript("recommendationChecklist")?.call(withArguments: [sources])?.toArray() as? [JournalObject] ?? []
    }

    static func set(_ item: JournalObject, done: Bool, visit: String, profile: inout JournalObject) throws {
        let collection = caption(item, "collection"), id = caption(item, "source"), key = caption(item, "id")
        guard ["files", "recommendations"].contains(collection),
              let source = sources(profile, visit: visit).first(where: { caption($0, "collection") == collection && caption($0, "id") == id }),
              groups([source]).flatMap({ entries($0, "items") }).contains(where: { caption($0, "id") == key }) else {
            throw JournalError("Рекомендация изменилась. Откройте актуальную карточку.")
        }
        var rows = entries(profile, collection)
        guard let index = rows.firstIndex(where: { caption($0, "id") == id && caption($0, "visit") == visit }) else {
            throw JournalError("Рекомендация больше недоступна.")
        }
        var checks = rows[index]["recommendationChecks"] as? JournalObject ?? [:]
        if done { checks[key] = true } else { checks.removeValue(forKey: key) }
        rows[index]["recommendationChecks"] = checks
        profile[collection] = rows
    }
}

struct NativeVisitRecommendations: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, visit: String
    @State private var error = ""

    var body: some View {
        let profile = journal.profile(owner), sources = NativeRecommendationChecklist.sources(profile, visit: visit)
        let groups = NativeRecommendationChecklist.groups(sources)
        Section("Рекомендации врача") {
            if sources.isEmpty { Text("Рекомендаций пока нет.").foregroundStyle(.secondary) }
            ForEach(groups, id: \.clinicalRecordID) { group in
                Text(caption(group, "title")).font(JournalTheme.body.weight(.semibold)).foregroundStyle(JournalTheme.green)
                    .accessibilityAddTraits(.isHeader)
                let items = entries(group, "items")
                ForEach(items.indices, id: \.self) { index in recommendation(items[index]) }
            }
            ForEach(sources.indices, id: \.self) { index in
                let source = sources[index], original = caption(source, "file")
                DisclosureGroup(original.isEmpty ? "Исходный текст" : "Текст из бланка") {
                    Text(caption(source, "text"))
                }
                if let file = entries(profile, "files").first(where: { caption($0, "id") == original }) {
                    NavigationLink("Оригинал рекомендации") {
                        DeviceAttachment(journal: journal, owner: owner, id: original, name: caption(file, "name"))
                    }
                }
            }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }
    }

    private func recommendation(_ item: JournalObject) -> some View {
        let done = item["done"] as? Bool == true, text = caption(item, "text")
        return Group {
            if journal.editable {
                Button {
                    do {
                        try journal.changeProfile(owner) { try NativeRecommendationChecklist.set(item, done: !done, visit: visit, profile: &$0) }
                        error = ""
                    } catch { self.error = error.localizedDescription }
                } label: { recommendationLabel(text, done: done) }
                .buttonStyle(.plain).disabled(journal.busy)
                .accessibilityLabel(text).accessibilityValue(done ? "Выполнено" : "К выполнению")
            } else {
                recommendationLabel(text, done: done)
                    .accessibilityElement(children: .ignore).accessibilityLabel(text)
                    .accessibilityValue(done ? "Выполнено" : "К выполнению")
            }
        }
    }

    private func recommendationLabel(_ text: String, done: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: done ? "checkmark.square.fill" : "square")
                .foregroundStyle(JournalTheme.green).accessibilityHidden(true)
            Text(text).frame(maxWidth: .infinity, alignment: .leading)
        }.frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
    }
}

private extension Dictionary where Key == String, Value == Any {
    var clinicalRecordID: String { caption(self, "id") }
}
