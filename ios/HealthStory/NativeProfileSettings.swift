import SwiftUI

struct NativeProfileSettings: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String
    let chatGPTAccount: NativeChatGPTAccount?

    var body: some View {
        List {
            if journal.editable {
                NavigationLink {
                    NativeChatGPTSettings(account: chatGPTAccount)
                } label: { JournalRowLabel(title: "ИИ-провайдеры", symbol: "sparkles") }
                NavigationLink {
                    NativePromptSettings(journal: journal, owner: owner)
                } label: { JournalRowLabel(title: "Промпты и согласие", symbol: "text.bubble") }
                NavigationLink {
                    ManageNativeRecords(journal: journal, owner: owner)
                } label: { JournalRowLabel(title: "Управление данными", symbol: "list.bullet.rectangle") }
            }
            NavigationLink {
                NativeTagLibrary(journal: journal)
            } label: { JournalRowLabel(title: "Справочник тегов", symbol: "tag") }

            ProfileSyncLinks(journal: journal, owner: owner)
            if journal.admin {
                Section("Резервная копия") {
                    NavigationLink("Google Диск") { DriveBackupView(journal: journal) }
                    NavigationLink("Проверить файл копии") { ArchiveBackupInspection() }
                    NavigationLink("Ключ восстановления в iCloud") { CloudArchiveKeySettings(journal: journal) }
                }
            }
        }.journalBackground().navigationTitle("Настройки")
    }
}
