import Foundation
import CryptoKit

struct DuplicateClinicalCard: LocalizedError, Identifiable {
    let id: String
    var errorDescription: String? { "В этом профиле уже есть карточка с такими данными." }
}

enum ClinicalDuplicates {
    static func text(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping.split(whereSeparator:\.isWhitespace)
            .joined(separator:" ").lowercased(with:Locale(identifier:"ru"))
    }

    private static func fields(_ row: JournalObject, _ keys: [String]) -> [String] {
        keys.map{text(caption(row,$0))}
    }

    private static func rows(_ rows: [JournalObject], _ keys: [String]) -> [[String]] {
        rows.map{fields($0,keys)}.sorted{$0.lexicographicallyPrecedes($1)}
    }

    struct Key: Equatable {
        let scalars: [String]
        let values: [[String]]
    }

    static func visit(_ row: [Any], doctors: [JournalObject]) -> Key {
        let field: (Int) -> String = { index in row.indices.contains(index) ? row[index] as? String ?? "" : "" }
        let doctor=doctors.first{caption($0,"id")==field(3)}?["values"] as? [String] ?? []
        let clinic=row.indices.contains(9) ? field(9) : doctor.dropFirst(2).first ?? ""
        let medicines=row.indices.contains(8) ? row[8] as? [JournalObject] ?? [] : []
        return Key(scalars:[field(1),field(2),doctor.first ?? field(3),doctor.dropFirst().first ?? "",clinic,field(5)].map(text),
                   values:rows(medicines,["name","strength","form","instructions"]))
    }

    static func exam(_ row: JournalObject) -> Key? {
        let parameters=entries(row,"parameters")
        guard !caption(row,"description").trim.isEmpty || !caption(row,"conclusion").trim.isEmpty || !parameters.isEmpty else { return nil }
        return Key(scalars:fields(row,["date","method","region","clinic","doctor","description","conclusion"]),
                   values:rows(parameters,["name","value","unit"]))
    }

    static func lab(_ row: JournalObject) -> Key {
        Key(scalars:fields(row,["date","name","laboratory"]),
            values:rows(entries(row,"rows"),["name","value","unit","range","specimen"]))
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()
    }

    static func visitSource(_ row:JournalObject) -> Bool {
        caption(row,"category")=="Назначения" &&
            (row["visitSource"] as? Bool==true || row["visitImportRevision"] != nil ||
             (row["intake"] as? Bool != true && !caption(row,"raw").isEmpty))
    }
}
