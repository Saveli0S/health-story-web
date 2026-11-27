import Foundation

/// Resolve the family dictionary against the same record keys and evidence as the web journal.
struct RecordTags {
    typealias Row = [String: Any]
    private let labels: [String: [String]]
    private let applied: [String: Set<String>]
    private let automatic: [String: Set<String>]
    private let specialties: [String: String]

    init(profile: Row, library: [Row]) {
        var result = [String: [String]]()
        var appliedByKey = [String: Set<String>](), automaticByKey = [String: Set<String>]()
        var overrides = [String: [String: Bool]]()
        for row in profile["tagEdits"] as? [Row] ?? [] {
            if let key = row["id"] as? String { overrides[key] = row["values"] as? [String: Bool] }
        }
        var doctors = [String: String]()
        for row in profile["addedDoctors"] as? [Row] ?? [] {
            if let id = row["id"] as? String, let values = row["values"] as? [String], values.count > 1 {
                doctors[id] = values[1]
            }
        }
        specialties = doctors
        let terms = library.compactMap { row -> (String, String, [String])? in
            guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
            let terms = ([name] + (row["keywords"] as? [String] ?? [])).map(Self.words).filter { !$0.isEmpty }
            return (id, name, terms)
        }
        func index(_ kind: String, _ id: String, _ parts: [String]) {
            let key = kind + ":" + id
            let evidence = " " + Self.words(parts.joined(separator: " ")) + " "
            var matches = 0
            result[key] = terms.compactMap { tagID, name, keywords in
                let inferred = matches < 3 && keywords.contains { evidence.contains(" " + $0 + " ") }
                if inferred {
                    matches += 1
                    automaticByKey[key,default:[]].insert(tagID)
                }
                guard overrides[key]?[tagID] ?? inferred else {return nil}
                appliedByKey[key,default:[]].insert(tagID)
                return name
            }
        }
        for visit in profile["addedVisits"] as? [[Any]] ?? [] {
            guard visit.count > 3, let id = visit[0] as? String else { continue }
            index("visit", id, [doctors[visit[3] as? String ?? ""] ?? "", visit[2] as? String ?? ""])
        }
        for file in profile["files"] as? [Row] ?? [] {
            guard let id = file["id"] as? String, file["examDraft"] == nil else { continue }
            let lab = (file["lab"] ?? file["labDraft"]) as? Row ?? [:]
            let evidence = [file["name"], lab["name"], lab["category"], file["category"], file["clinicalText"],
                            file["checked"] as? Bool == true ? file["context"] : nil].compactMap { $0 as? String }
            index("file", id, evidence)
            if !lab.isEmpty || file["category"] as? String == "Лаборатория" { index("lab", id, evidence) }
        }
        for exam in profile["exams"] as? [Row] ?? [] {
            if let id = exam["id"] as? String { index("exam", id, [exam["method"],exam["region"]].compactMap { $0 as? String }) }
        }
        let kinds = ["vaccine":"Прививка","lab":"Плановый анализ","procedure":"Процедура"]
        for row in profile["prevention"] as? [Row] ?? [] {
            if let id = row["id"] as? String { index("prevent", id, [kinds[row["kind"] as? String ?? ""] ?? "",row["title"] as? String ?? ""]) }
        }
        labels = result
        applied = appliedByKey
        automatic = automaticByKey
    }

    static func words(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "ё", with: "е")
            .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }

    func names(_ key: String) -> [String] { labels[key] ?? [] }
    func selectedIDs(_ key:String)->Set<String> {applied[key] ?? []}
    func inferredIDs(_ key:String)->Set<String> {automatic[key] ?? []}
    func specialty(_ id: String) -> String { specialties[id] ?? "" }
    func matches(_ query: String, key: String, fields: [String]) -> Bool {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        let term = Self.words(query)
        return !term.isEmpty && Self.words((fields + names(key)).joined(separator: " ")).contains(term)
    }
}
