import SwiftUI

struct ChatGPTMessage: Codable, Equatable, Sendable {
    enum Role: String, Codable, Sendable { case user, assistant }
    let role: Role
    let content: String
}

struct ChatGPTReply: Decodable, Sendable {
    let answer: String
    let model: String
}

// The account integration supplies a transport only once included-quota access is verified.
struct NativeChatGPTTransport: Sendable {
    let providerName: String
    let reply: @Sendable ([ChatGPTMessage]) async throws -> ChatGPTReply

    init(providerName: String = "ChatGPT", reply: @escaping @Sendable ([ChatGPTMessage]) async throws -> ChatGPTReply) {
        self.providerName = providerName
        self.reply = reply
    }

    static func gateway(
        at base: URL,
        planSession: @escaping @Sendable () async throws -> String,
        load: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse) = { try await ChatGPTHTTP.load($0) }
    ) throws -> Self {
        guard let parts=URLComponents(url:base,resolvingAgainstBaseURL:false),
              parts.scheme == "https", parts.host != nil, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil else {
            throw JournalError("Для подключения ChatGPT нужен защищённый адрес дневника.")
        }
        let endpoint=base.appending(path:"chatgpt/send")
        return Self { messages in
            let token=try await planSession()
            guard !token.isEmpty else { throw JournalError("Подключите личный ChatGPT. Вопрос сохранён.") }
            var request=URLRequest(url:endpoint,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:125)
            request.httpMethod="POST"
            request.setValue("application/json",forHTTPHeaderField:"Content-Type")
            request.setValue("application/json",forHTTPHeaderField:"Accept")
            request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
            request.httpBody=try JSONEncoder().encode(["messages":messages])
            let (body,response)=try await load(request)
            guard let http=response as? HTTPURLResponse else { throw JournalError("Не удалось получить ответ. Вопрос сохранён.") }
            switch http.statusCode {
            case 200:
                return try JSONDecoder().decode(ChatGPTReply.self,from:body)
            case 401:
                throw JournalError("Подключите ChatGPT повторно. Вопрос сохранён.")
            case 403:
                throw JournalError("Доступ к включённой квоте недоступен. Вопрос сохранён.")
            case 429:
                throw JournalError("Квота ChatGPT исчерпана. Вопрос сохранён.")
            default:
                throw JournalError("Не удалось получить ответ. Вопрос сохранён.")
            }
        }
    }
}

final class ChatGPTHTTP: NSObject, URLSessionTaskDelegate {
    private static let session = URLSession(configuration:.ephemeral,delegate:ChatGPTHTTP(),delegateQueue:nil)

    static func load(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for:request)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

extension EnvironmentValues {
    @Entry var nativeChatGPT: NativeChatGPTTransport? = nil
}

@MainActor
enum NativeChatGPTConversation {
    static func history(_ row: JournalObject) -> [ChatGPTMessage] {
        guard !caption(row,"answer").isEmpty else { return [] }
        let turns = [row] + entries(row,"turns")
        return turns.enumerated().flatMap { index, turn in
            [ChatGPTMessage(role:.user,content:caption(turn,index == 0 ? "prompt" : "question")),
             ChatGPTMessage(role:.assistant,content:caption(turn,"answer"))]
        }
    }

    static func edit(_ journal: DeviceJournal, owner: String, id: String, _ change: (inout JournalObject) throws -> Void) throws {
        try journal.changeProfile(owner) { profile in
            var records = entries(profile,"consultations")
            guard let index = records.firstIndex(where:{caption($0,"id") == id}) else {
                throw JournalError("Консультация недоступна. Откройте историю.")
            }
            try change(&records[index])
            profile["consultations"] = records
        }
    }

    static func transfer(_ journal: DeviceJournal) -> JournalObject {
        let actor = NativePromptLibrary.actor(journal)
        let name = journal.members.first{caption($0,"id") == actor}.map{caption($0,"name")} ?? ""
        return ["id":UUID().uuidString,"kind":"provider","role":journal.admin ? "admin" : "adult",
                "actorId":actor,"actorName":name,"time":ISO8601DateFormatter().string(from:Date())]
    }

    static func save(_ reply: ChatGPTReply, question: String, previous: [ChatGPTMessage],
                     sentHistory: [ChatGPTMessage], transfer: JournalObject, providerName: String, in row: inout JournalObject) throws {
        let answer = reply.answer
        guard !answer.trim.isEmpty, !reply.model.trim.isEmpty else {
            throw JournalError("Провайдер не вернул завершённый ответ. Вопрос сохранён.")
        }
        guard history(row) == previous, caption(row,previous.isEmpty ? "prompt" : "nextQuestion") == question else {
            throw JournalError("Консультация изменилась на другом устройстве. Откройте историю перед отправкой.")
        }
        let time = ISO8601DateFormatter().string(from:Date())
        let provider = providerName + " · " + reply.model
        if previous.isEmpty {
            row["answer"] = answer
            row["answeredAt"] = time
            row["sentAt"] = caption(transfer,"time")
            row["provider"] = provider
            row["transfers"] = entries(row,"transfers") + [transfer]
        } else {
            var turn: JournalObject = ["id":UUID().uuidString,"question":question,"answer":answer,
                                       "time":time,"provider":provider,"transfers":[transfer]]
            if previous != sentHistory {
                turn["sentHistory"] = sentHistory.map{["role":$0.role.rawValue,"content":$0.content]}
            }
            row["turns"] = entries(row,"turns") + [turn]
            row["nextQuestion"] = ""
        }
    }
}
