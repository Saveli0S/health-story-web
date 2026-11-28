import SwiftUI

struct NativePrescriptionEditor: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, course: NativeCourse
    @Environment(\.dismiss) private var dismiss
    @State private var medicine: NativeMedicine
    @State private var validation = JournalFormValidation()
    @State private var error = ""

    init(journal: DeviceJournal, owner: String, course: NativeCourse) {
        self.journal = journal
        self.owner = owner
        self.course = course
        _medicine = State(initialValue: NativeMedicine(name: caption(course.medicine, "name"),
            strength: caption(course.medicine, "strength"), form: caption(course.medicine, "form"),
            instructions: caption(course.medicine, "instructions")))
    }

    var body: some View {
        Form {
            NativePrescriptionFields(medicine: $medicine, issues: validation.visible(medicine.validationIssues))
            Button("Сохранить назначение") {
                guard validation.submit(medicine.validationIssues) else { return }
                do {
                    let updated = try medicine.record()
                    try journal.changeProfile(owner) { profile in
                        try NativeTreatments.update(course, in: &profile) { original in
                            guard NativeTreatments.signature(original) == NativeTreatments.signature(course.medicine) else {
                                throw JournalError("Назначение изменилось. Откройте его повторно.")
                            }
                            var record = original
                            for key in ["name", "strength", "form", "instructions"] { record[key] = updated[key] }
                            return record
                        }
                    }
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }.disabled(!journal.editable || journal.busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.journalValidation(validation).navigationTitle("Редактировать назначение")
    }
}

private struct NativePrescriptionFields: View {
    @Binding var medicine: NativeMedicine
    let issues: [JournalFieldIssue]
    var showName = true
    var body: some View {
        if showName {
            TextField("Лекарство", text: $medicine.name).journalField(medicine.field("name"), issues)
        }
        TextField("Дозировка", text: $medicine.strength).journalField(medicine.field("strength"), issues)
        TextField("Форма", text: $medicine.form)
        TextField("Схема приёма", text: $medicine.instructions).journalField(medicine.field("instructions"), issues)
    }
}

struct NativeTherapyEditor: View {
    enum Decision: String, CaseIterable {
        case none = "", continued = "continue", dose, replace, stop
        var title: String {
            switch self {
            case .none: "Без решения"
            case .continued: "Продолжить"
            case .dose: "Изменить дозу"
            case .replace: "Заменить"
            case .stop: "Отменить"
            }
        }
        var requiresPrescription: Bool { self == .dose || self == .replace }
    }

    @ObservedObject var journal: DeviceJournal
    let owner: String, visit: String
    @Environment(\.dismiss) private var dismiss
    @State private var choices: [CourseSource: Decision] = [:]
    @State private var replacements: [CourseSource: NativeMedicine] = [:]
    @State private var validation = JournalFormValidation()
    @State private var error = ""

    var body: some View {
        let profile = journal.profile(owner)
        let courses = candidates(profile)
        let issues = courses.compactMap { selectedPrescription($0) }.flatMap(\.validationIssues)
        Form {
            if courses.isEmpty { Text("Доступных курсов из предыдущих визитов нет.") }
            ForEach(courses) { course in
                Section(course.title) {
                    Text(course.visitTitle + " · " + course.date).foregroundStyle(.secondary)
                    Picker("Решение", selection: Binding(get: { choices[course.id] ?? .none }, set: { decision in
                        choices[course.id] = decision
                        if decision.requiresPrescription && replacements[course.id] == nil {
                            replacements[course.id] = NativeMedicine(name: caption(course.medicine, "name"),
                                strength: caption(course.medicine, "strength"), form: caption(course.medicine, "form"),
                                instructions: caption(course.medicine, "instructions"))
                        }
                    })) {
                        ForEach(Decision.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    if choices[course.id]?.requiresPrescription == true, let medicine = replacements[course.id] {
                        NativePrescriptionFields(medicine: Binding(get: { replacements[course.id] ?? medicine },
                            set: { replacements[course.id] = $0 }), issues: validation.visible(issues),
                            showName: choices[course.id] == .replace)
                    }
                }
            }
            Button("Сохранить решения") {
                guard validation.submit(issues) else { return }
                save(previous: courses)
            }.disabled(!journal.editable || journal.busy || !choices.values.contains { $0 != .none })
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.journalValidation(validation).navigationTitle("Решения по предыдущей схеме")
    }

    private func candidates(_ profile: JournalObject) -> [NativeCourse] {
        guard let current = NativeTreatments.visits(profile).first(where: { NativeTreatments.field($0, 0) == visit }) else { return [] }
        let date = NativeTreatments.field(current, 1), episode = NativeTreatments.episode(current, profile)
        let decisions = entries(profile, "changes")
        return NativeTreatments.all(profile).filter { course in
            course.episode == episode && course.visit != visit && course.date <= date && !course.continued &&
                !caption(course.medicine, "id").isEmpty &&
                (course.change == nil || caption(course.change ?? [:], "date") > date) &&
                (!course.period.closed || course.period.end > date) &&
                !decisions.contains { caption($0, "visit") == visit && caption($0, "source") == course.visit &&
                    caption($0, "medId") == caption(course.medicine, "id") }
        }
    }

    private func selectedPrescription(_ course: NativeCourse) -> NativeMedicine? {
        guard let choice = choices[course.id], choice.requiresPrescription, var medicine = replacements[course.id] else { return nil }
        if choice == .dose { medicine.name = caption(course.medicine, "name") }
        return medicine
    }

    private func save(previous: [NativeCourse]) {
        do {
            try journal.changeProfile(owner) { profile in
                guard let row = NativeTreatments.visits(profile).first(where: { NativeTreatments.field($0, 0) == visit }) else {
                    throw JournalError("Визит больше недоступен.")
                }
                let latest = candidates(profile)
                let changes: [JournalObject] = try previous.compactMap { course in
                    guard let decision = choices[course.id], decision != .none else { return nil }
                    guard let current = latest.first(where: { $0.id == course.id }),
                          NativeTreatments.signature(current.medicine) == NativeTreatments.signature(course.medicine) else {
                        throw JournalError("Предыдущая схема изменилась. Откройте визит заново.")
                    }
                    let before = Dictionary(uniqueKeysWithValues: ["name", "strength", "form", "instructions"].map { ($0, caption(current.medicine, $0)) })
                    let replacement = try selectedPrescription(current)?.record()
                    return ["id": UUID().uuidString, "kind": decision.rawValue, "visit": visit,
                            "episode": NativeTreatments.episode(row, profile), "date": NativeTreatments.field(row, 1),
                            "doctor": NativeTreatments.field(row, 3), "source": current.visit,
                            "medId": caption(current.medicine, "id"), "before": before,
                            "replacement": replacement as Any? ?? NSNull()]
                }
                profile["changes"] = entries(profile, "changes") + changes
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
