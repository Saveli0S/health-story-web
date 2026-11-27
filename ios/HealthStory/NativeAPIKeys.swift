import Security
import SwiftUI

enum NativeAIProvider: String, CaseIterable, Hashable, Sendable {
    case chatGPT, deepseek, anthropic

    static let keyed: [Self] = [.deepseek, .anthropic]
    static let cost = "Запросы по API-ключу могут расходовать баланс провайдера."

    var label: String {
        switch self {
        case .chatGPT: "ChatGPT"
        case .deepseek: "DeepSeek"
        case .anthropic: "Claude (Anthropic)"
        }
    }

    var model: String {
        switch self {
        case .chatGPT: ""
        case .deepseek: "deepseek-flash"
        case .anthropic: "claude-haiku-5-5"
        }
    }

    private struct Models: Decodable {
        struct Model: Decodable { let id: String }
        let data: [Model]
        let has_more: Bool?
    }

    private struct Completion: Decodable {
        struct Block: Decodable { let type: String; let text: String? }
        struct Choice: Decodable {
            struct Message: Decodable { let content: String? }
            let message: Message
            let finish_reason: String?
        }
        let model: String
        let content: [Block]?
        let choices: [Choice]?
        let stop_reason: String?
    }

    private struct Payload: Encodable {
        struct Thinking: Encodable { let type = "disabled" }
        let model: String
        let messages: [ChatGPTMessage]
        let max_tokens = 4096
        let thinking: Thinking?
    }

    func check(_ key: String) async throws {
        let data = try await request(key, messages: nil)
        guard let response = try? JSONDecoder().decode(Models.self, from: data) else {
            throw JournalError("Не удалось проверить ключ у провайдера.")
        }
        guard response.data.contains(where: { $0.id == model }) || self == .anthropic && response.has_more == true else {
            throw failure(404)
        }
    }

    func generate(_ key: String, messages: [ChatGPTMessage]) async throws -> ChatGPTReply {
        let data = try await request(key, messages: messages)
        guard let response = try? JSONDecoder().decode(Completion.self, from: data) else {
            throw JournalError("Провайдер вернул неизвестный формат ответа.")
        }
        if response.stop_reason == "max_tokens" || response.choices?.first?.finish_reason == "length" {
            throw JournalError("Достигнут лимит длины ответа. Сократите запрос и повторите.")
        }
        let answer = self == .anthropic
            ? response.content?.filter { $0.type == "text" }.compactMap(\.text).joined(separator: "\n")
            : response.choices?.first?.message.content
        guard let answer, !answer.trim.isEmpty, !response.model.trim.isEmpty else {
            throw JournalError("Провайдер вернул пустой ответ.")
        }
        return ChatGPTReply(answer: answer, model: response.model)
    }

    private func request(_ key: String, messages: [ChatGPTMessage]?) async throws -> Data {
        guard self != .chatGPT else { throw JournalError("Подключите личный ChatGPT.") }
        let base = self == .deepseek ? "https://api.deepseek.com/" : "https://api.anthropic.com/v1/"
        let path = messages == nil ? "models" : self == .deepseek ? "chat/completions" : "messages"
        var request = URLRequest(url: URL(string: base + path)!,
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: messages == nil ? 15 : 120)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if self == .deepseek {
            request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        } else {
            request.setValue(key, forHTTPHeaderField: "x-api-key")
            request.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        }
        if let messages {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(Payload(model: model, messages: messages,
                                                               thinking: self == .deepseek ? .init() : nil))
        }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await ChatGPTHTTP.load(request) }
        catch { throw JournalError("Нет связи с " + label + ". Проверьте доступ к API.") }
        guard let http = response as? HTTPURLResponse else { throw failure(500) }
        guard (200..<300).contains(http.statusCode) else { throw failure(http.statusCode) }
        return data
    }

    private func failure(_ status: Int) -> JournalError {
        switch status {
        case 401: JournalError("Провайдер не принял API-ключ.")
        case 403: JournalError("Проверьте права ключа и доступность API в вашем регионе.")
        case 402: JournalError("Недостаточно средств на балансе провайдера.")
        case 429: JournalError("Лимит API исчерпан. Повторите позже.")
        case 400, 404: JournalError("Проверьте доступность модели " + model + " и баланс API.")
        default: JournalError("API провайдера сейчас недоступен.")
        }
    }
}

@MainActor @Observable
final class NativeAPIKeys {
    private var context: String?
    private(set) var connected: Set<NativeAIProvider> = []
    private(set) var preferredProvider: NativeAIProvider?

    static func selection(_ journal: DeviceJournal) -> String? {
        let family = caption(journal.data["family"] as? JournalObject ?? [:], "id")
        let actor = NativePromptLibrary.actor(journal)
        return journal.editable && !family.isEmpty && !actor.isEmpty ? family + "/" + actor : nil
    }

    func activate(_ next: String?) {
        context = next
        connected = Set(NativeAIProvider.keyed.filter { key($0) != nil })
        preferredProvider = next.flatMap {
            UserDefaults.standard.string(forKey: preferenceKey($0)).flatMap(NativeAIProvider.init(rawValue:))
        }
    }

    func setPreferredProvider(_ provider: NativeAIProvider?) {
        guard let context else { return }
        UserDefaults.standard.set(provider?.rawValue, forKey: preferenceKey(context))
        preferredProvider = provider
    }

    func connect(_ provider: NativeAIProvider, _ input: String) async throws {
        let value = input.trim
        guard let context, (8...512).contains(value.utf8.count),
              value.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw JournalError("Введите API-ключ без пробелов.")
        }
        try await provider.check(value)
        guard self.context == context else { throw JournalError("Откройте настройки провайдеров снова.") }
        try NativeAIKeychain.save(value, for: account(provider, context), service: Self.service)
        connected.insert(provider)
    }

    func disconnect(_ provider: NativeAIProvider) throws {
        guard let context else { return }
        try NativeAIKeychain.remove(account(provider, context), service: Self.service)
        connected.remove(provider)
    }

    func transport(_ provider: NativeAIProvider) -> NativeChatGPTTransport? {
        guard connected.contains(provider), let context else { return nil }
        return NativeChatGPTTransport(providerName: provider.label) { [weak self] messages in
            guard let value = await self?.key(provider, in: context) else {
                throw JournalError("Подключите API-ключ повторно. Запрос сохранён.")
            }
            return try await provider.generate(value, messages: messages)
        }
    }

    private static let service = "by.healthstory.ai-api-key"
    private func preferenceKey(_ context: String) -> String {
        "healthstory.preferred-provider." + context
    }
    private func account(_ provider: NativeAIProvider, _ context: String) -> String {
        context + "/" + provider.rawValue
    }
    private func key(_ provider: NativeAIProvider, in expected: String? = nil) -> String? {
        guard let context, expected == nil || expected == context else { return nil }
        return NativeAIKeychain.load(account(provider, context), service: Self.service)
    }
}

extension EnvironmentValues {
    @Entry var nativeAPIKeys: NativeAPIKeys? = nil
}

struct NativeProviderChoice<Actions: View>: View {
    @Environment(\.nativeAPIKeys) private var keys
    @Environment(\.nativeChatGPT) private var chatGPT
    let preferred: String
    @Binding var choice: NativeAIProvider?
    @ViewBuilder let actions: (NativeChatGPTTransport?) -> Actions

    var options: [NativeAIProvider] {
        (chatGPT == nil ? [] : [.chatGPT]) + NativeAIProvider.keyed.filter { keys?.connected.contains($0) == true }
    }

    var selection: NativeAIProvider? {
        options.first(where: { $0 == choice })
            ?? options.first(where: { preferred.hasPrefix($0.label + " · ") })
            ?? options.first(where: { $0 == keys?.preferredProvider })
            ?? options.first
    }

    var transport: NativeChatGPTTransport? {
        guard let selection else { return nil }
        return selection == .chatGPT ? chatGPT : keys?.transport(selection)
    }

    var body: some View {
        if options.count > 1 {
            Picker("Провайдер", selection: Binding(get: { selection }, set: { choice = $0 })) {
                ForEach(options, id: \.self) { provider in Text(provider.label).tag(Optional(provider)) }
            }
        }
        if let selection, selection != .chatGPT {
            Text(NativeAIProvider.cost).font(.footnote).foregroundStyle(.secondary)
        }
        actions(transport)
    }
}

struct NativeAPIKeyRows: View {
    let provider: NativeAIProvider
    let keys: NativeAPIKeys
    @State private var value = ""
    @State private var message = ""
    @State private var checking = false

    var body: some View {
        Section(provider.label) {
            Text("Модель " + provider.model + ". Ключ хранится в Связке ключей этого iPhone.").font(.footnote)
            if keys.connected.contains(provider) {
                Text("Ключ проверен.")
                Button("Отключить " + provider.label, role: .destructive) {
                    do { try keys.disconnect(provider); message = "" }
                    catch { message = error.localizedDescription }
                }
            } else {
                SecureField("API-ключ " + provider.label, text: $value)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(checking ? "Проверяем ключ…" : "Проверить и подключить " + provider.label) {
                    let input = value
                    value = ""; message = ""; checking = true
                    Task {
                        defer { checking = false }
                        do { try await keys.connect(provider, input) }
                        catch { message = error.localizedDescription }
                    }
                }.disabled(value.trim.isEmpty || checking)
            }
            if !message.isEmpty { Text(message).foregroundStyle(.red) }
        }
    }
}
