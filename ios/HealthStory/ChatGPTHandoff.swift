import SwiftUI
import UniformTypeIdentifiers

@MainActor
enum ChatGPTHandoff {
    static let website = URL(string: "https://chatgpt.com/")!
    private static let newChat = URL(string: "https://chatgpt.com/#native")!

    static func copy(_ prompt: String) {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: prompt]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)]
        )
    }

    static func openNewChat() async -> Bool {
        await UIApplication.shared.open(newChat, options: [.universalLinksOnly: true])
    }
}

struct ChatGPTRequestFile: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    let bytes: Data

    init(_ text: String) { bytes = Data(text.utf8) }

    init(configuration: ReadConfiguration) throws {
        guard let bytes = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.bytes = bytes
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: bytes)
    }
}
