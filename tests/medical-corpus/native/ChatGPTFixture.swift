import Foundation

private actor FixtureRequests {
    var quotaReturned = false
    var treatmentQuotaReturned = false

    func load(_ request: URLRequest) throws -> (Data, URLResponse) {
        guard let url=request.url, url.absoluteString=="https://health-story.test/journal/chatgpt/send",
              request.httpMethod=="POST", request.value(forHTTPHeaderField:"Authorization")=="Bearer synthetic",
              let data=request.httpBody else {
            throw JournalError("Адрес или заголовки тестового запроса отличаются.")
        }
        let payload=try JSONDecoder().decode([String:[ChatGPTMessage]].self,from:data)
        guard let messages=payload["messages"],payload.count==1 else { throw JournalError("В запросе есть лишние поля.") }
        if messages.count==1,let text=messages.first?.content,text.contains("TEST-CLAIM"){
            guard text.contains("QA-анализ"), ["example.org","Private-filename.pdf","Рина Примерова","Мая Макетова","PRIVATE-OTHER-PROFILE"].allSatisfy({!text.contains($0)}) else {
                throw JournalError("Не прошла сверка отправленных сведений.")
            }
            if !treatmentQuotaReturned {treatmentQuotaReturned=true;return try response(url,429,answer:"")}
            return try response(url,200,answer:"Учебный ответ по лечению")
        }
        let initial = ChatGPTMessage(role:.user,content:"First fixture question")
        let answer = ChatGPTMessage(role:.assistant,content:"Первый [имя скрыто] ответ: [клиника скрыта], [имя файла скрыто]")
        let next = ChatGPTMessage(role:.user,content:"QA follow up")
        if messages == [initial] { return try response(url,200,answer:"Первый учебный ответ: Стенд, Учебный протокол.txt") }
        guard messages == [initial,answer,next] else {
            throw JournalError("Отправленный текст отличается от проверенного примера.")
        }
        if !quotaReturned {
            quotaReturned=true
            return try response(url,429,answer:"")
        }
        return try response(url,200,answer:"Второй учебный ответ")
    }

    private func response(_ url: URL, _ status: Int, answer: String) throws -> (Data, URLResponse) {
        let body=try JSONEncoder().encode(["answer":answer,"model":"Учебная модель"])
        return (body,HTTPURLResponse(url:url,statusCode:status,httpVersion:nil,headerFields:nil)!)
    }
}

enum ChatGPTFixture {
    private static let requests = FixtureRequests()
    static let transport = try! NativeChatGPTTransport.gateway(
        at:URL(string:"https://health-story.test/journal/")!,
        planSession:{ "synthetic" },
        load:{ try await requests.load($0) }
    )
}
