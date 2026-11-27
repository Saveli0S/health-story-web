import SwiftUI

struct JournalFieldIssue {
    let field: String
    let message: String

    static func required(_ field: String, _ value: String, _ message: String) -> Self? {
        value.trim.isEmpty ? Self(field: field, message: message) : nil
    }

    static func length(_ field: String, _ value: String, limit: Int) -> Self? {
        value.trim.count > limit ? Self(field: field, message: "Введите не более \(limit) символов.") : nil
    }

    static func recoveryKey(_ value: String, rejected: Bool = false) -> Self? {
        if let required = required("recovery-key", value, "Введите семейный ключ восстановления.") {
            return required
        }
        if (try? decodeKey(value.trim)) == nil {
            return Self(field: "recovery-key", message: "Проверьте ключ восстановления. Вставьте его целиком.")
        }
        return rejected ? Self(field: "recovery-key", message: "Не удалось расшифровать копию. Проверьте файл и семейный ключ.") : nil
    }
}

struct JournalBackupKeyForm: View {
    let action: String
    let submit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var validation = JournalFormValidation()

    var body: some View {
        let issues = [JournalFieldIssue.recoveryKey(key)].compactMap { $0 }
        NavigationStack {
            Form {
                SecureField("Семейный ключ восстановления", text: $key)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .journalField("recovery-key", validation.visible(issues))
                Text(familyRecoveryKeyHelp).font(.footnote).foregroundStyle(.secondary)
                Button(action) {
                    guard validation.submit(issues) else { return }
                    dismiss()
                    submit(key.trim)
                }
            }
            .journalValidation(validation)
            .navigationTitle("Семейный ключ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
    }
}

struct JournalFormValidation {
    private(set) var attempt = 0
    private(set) var firstField: String?

    mutating func submit(_ issues: [JournalFieldIssue]) -> Bool {
        firstField = issues.first?.field
        if firstField != nil { attempt += 1 }
        return firstField == nil
    }

    func visible(_ issues: [JournalFieldIssue]) -> [JournalFieldIssue] {
        attempt > 0 ? issues : []
    }
}

extension View {
    func journalField(_ field: String, _ issues: [JournalFieldIssue]) -> some View {
        let message = issues.first { $0.field == field }?.message
        return VStack(alignment: .leading, spacing: 5) {
            self.overlay {
                if message != nil {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(JournalTheme.fieldError, lineWidth: 1)
                        .padding(.horizontal, -6)
                        .padding(.vertical, -2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            if let message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(JournalTheme.fieldError)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("validation-" + field)
            }
        }
        .id(field)
    }

    func journalValidation(_ validation: JournalFormValidation) -> some View {
        ScrollViewReader { scroll in
            self.onChange(of: validation.attempt) { _, _ in
                if let field = validation.firstField {
                    scroll.scrollTo(field, anchor: .center)
                }
            }
        }
    }
}
