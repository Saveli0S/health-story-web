import Foundation

enum NativeAPIKeyFixture {
    static func load(_ request: URLRequest) async throws -> (Data, URLResponse) {
        let url = request.url!
        let claude = url.host == "api.anthropic.com"
        let model = claude ? "claude-haiku-5-5" : "deepseek-flash"
        let key = claude ? request.value(forHTTPHeaderField: "x-api-key") : request.value(forHTTPHeaderField: "Authorization")
        let expectedKey = claude ? "synthetic-anthropic-key" : "Bearer synthetic-deepseek-key"
        var status = 200
        var body: [String: Any] = [:]
        if key != expectedKey {
            status = 401
        } else if url.path.hasSuffix("/models") && request.httpMethod == "GET" && request.httpBody == nil {
            body = ["data": [["id": model]]]
        } else if request.httpMethod == "POST", let bytes = request.httpBody,
                  let payload = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  let messages = payload["messages"] as? [[String: String]],
                  payload["model"] as? String == model, payload["max_tokens"] as? Int == 4096,
                  !String(decoding: bytes, as: UTF8.self).contains("synthetic-"), !String(decoding: bytes, as: UTF8.self).contains("example.org") {
            if claude, url.path == "/v1/messages", messages.map({ $0["role"] }) == ["user", "assistant", "user"],
               request.value(forHTTPHeaderField: "anthropic-version") == "2026-10-21" {
                body = ["model": model, "content": [["type": "thinking"], ["type": "text", "text": "Учебный ответ Claude"]]]
            } else if !claude, url.host == "api.deepseek.com", url.path == "/chat/completions",
                      messages.map({ $0["role"] }) == ["user"], (payload["thinking"] as? [String: String])?["type"] == "disabled" {
                body = ["model": model, "choices": [["message": ["content": "Учебный ответ DeepSeek"]]]]
            } else {
                status = 400
            }
        } else {
            status = 400
        }
        return (try JSONSerialization.data(withJSONObject: body),
                HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
