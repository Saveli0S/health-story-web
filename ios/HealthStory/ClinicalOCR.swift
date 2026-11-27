import Foundation
import PDFKit
import Vision
import UIKit
import ImageIO

struct RecognizedDocument {
    var text = ""
    // Vision only supplies line confidence. Never ascribe it to individual digits.
    var uncertainLines: [[String: Any]] = []
    var warnings: [String] = []
}

enum ClinicalOCR {
    static func read(_ data: Data, mime: String, pdfRows: Bool = false) throws -> RecognizedDocument {
        if mime.hasPrefix("text/") {
            return RecognizedDocument(text: String(decoding: data, as: UTF8.self))
        }
        if mime == "application/pdf" || data.starts(with: Data("%PDF".utf8)) {
            guard let pdf = PDFDocument(data: data), !pdf.isLocked, pdf.pageCount > 0 else {
                throw NSError(domain:"ClinicalOCR",code:1,userInfo:[NSLocalizedDescriptionKey:"Не удалось прочитать PDF. Проверьте исходный файл."])
            }
            var result = RecognizedDocument()
            var pages = [String]()
            for index in 0..<pdf.pageCount {
                let pageNumber = index + 1
                guard let page = pdf.page(at: index) else {
                    result.warnings.append("Не удалось открыть страницу \(pageNumber).")
                    continue
                }
                let extracted = pdfRows ? tableText(on: page) : page.string
                let native = extracted?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !native.isEmpty, !hasRaster(page) {
                    pages.append(native)
                    continue
                }
                // Text and scanned pages can occur in the same PDF.
                let bounds = page.bounds(for: .mediaBox).size
                let scale = 2400 / max(1, max(bounds.width,bounds.height))
                let size = CGSize(width:bounds.width*scale,height:bounds.height*scale)
                if let image = page.thumbnail(of:size,for:.mediaBox).cgImage,
                   let scan = try? recognize(image, orientation:.up, page:pageNumber), !scan.text.isEmpty {
                    let body=additionalLines(scan.text,native:native)
                    pages.append([native,body].filter{!$0.isEmpty}.joined(separator:"\n")); result.uncertainLines += scan.uncertainLines; result.warnings += scan.warnings
                } else {
                    if !native.isEmpty {pages.append(native)}
                    result.warnings.append("Графическая часть страницы \(pageNumber) не распознана. Сверьте оригинал и заполните пропуски.")
                }
            }
            result.text = pages.joined(separator:"\n\n")
            return result
        }
        guard let source = CGImageSourceCreateWithData(data as CFData,nil),
              let image = CGImageSourceCreateImageAtIndex(source,0,nil) else {
            throw NSError(domain:"ClinicalOCR",code:2,userInfo:[NSLocalizedDescriptionKey:"Не удалось прочитать изображение."])
        }
        let metadata = CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any]
        let orientation = CGImagePropertyOrientation(rawValue:metadata?[kCGImagePropertyOrientation] as? UInt32 ?? 1) ?? .up
        return try recognize(image, orientation:orientation, page:1)
    }

    private static func tableText(on page: PDFPage) -> String? {
        // PDFKit can return result and unit columns in separate blocks.
        let selections = page.selection(for: page.bounds(for: .cropBox))?.selectionsByLine() ?? []
        let cells = selections.compactMap { line -> (text: String, bounds: CGRect)? in
            guard let text = line.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            let bounds = line.bounds(for: page)
            return bounds.isEmpty ? nil : (text, bounds)
        }.sorted { $0.bounds.midY > $1.bounds.midY }
        if cells.isEmpty { return page.string }
        var rows = [[(text: String, bounds: CGRect)]]()
        for cell in cells {
            if let first = rows.last?.first,
               first.bounds.midY - cell.bounds.midY <= max(1, min(first.bounds.height, cell.bounds.height) * 0.35) {
                rows[rows.count - 1].append(cell)
            } else {
                rows.append([cell])
            }
        }
        return rows.map { row in
            row.sorted { $0.bounds.minX < $1.bounds.minX }.map(\.text).joined(separator: " ")
        }.joined(separator: "\n")
    }

    private static func hasRaster(_ page:PDFPage) -> Bool {
        guard let dict=page.pageRef?.dictionary else {return true}
        var resources:CGPDFDictionaryRef?
        guard CGPDFDictionaryGetDictionary(dict,"Resources",&resources) else {return true}
        func image(in root:CGPDFDictionaryRef?, depth:Int) -> Bool {
            var objects:CGPDFDictionaryRef?
            guard depth<8, let root, CGPDFDictionaryGetDictionary(root,"XObject",&objects), let objects else {return false}
            var found=false
            CGPDFDictionaryApplyBlock(objects,{_,value,_ in
                var stream:CGPDFStreamRef?
                guard CGPDFObjectGetValue(value,.stream,&stream),let stream,let desc=CGPDFStreamGetDictionary(stream) else {return true}
                var ptr:UnsafePointer<CChar>?
                guard CGPDFDictionaryGetName(desc,"Subtype",&ptr),let ptr else {return true}
                if String(cString:ptr)=="Image" {
                    var width=0,height=0
                    CGPDFDictionaryGetInteger(desc,"Width",&width);CGPDFDictionaryGetInteger(desc,"Height",&height)
                    found=max(width,height)>=200
                } else if String(cString:ptr)=="Form" {
                    var next:CGPDFDictionaryRef?
                    if CGPDFDictionaryGetDictionary(desc,"Resources",&next) {found=image(in:next,depth:depth+1)}
                }
                return !found
            },nil)
            return found
        }
        return image(in:resources,depth:0)
    }
    private static func additionalLines(_ ocr:String,native:String) -> String {
        if native.isEmpty {return ocr}
        func normalized(_ value:String) -> String {
            value.lowercased().filter{ $0.isLetter || $0.isNumber }
        }
        let original = normalized(native)
        return ocr.split(separator:"\n").map(String.init).filter {
            let candidate=normalized($0)
            return !candidate.isEmpty && !original.contains(candidate)
        }.joined(separator:"\n")
    }

    private static func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation, page: Int) throws -> RecognizedDocument {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = try request.supportedRecognitionLanguages()
        let languages = ["ru-RU", "en-US"].filter(supported.contains)
        if !languages.isEmpty {request.recognitionLanguages = languages}
        try VNImageRequestHandler(cgImage:image,orientation:orientation).perform([request])
        let observations = (request.results ?? []).compactMap { observation -> (CGRect,VNRecognizedText)? in
            guard let text = observation.topCandidates(1).first else { return nil }
            return (observation.boundingBox, text)
        }.sorted { $0.0.midY > $1.0.midY }
        // Rejoin columns at the same baseline before passing the rows to the table parser.
        var lines = [[(CGRect,VNRecognizedText)]]()
        for fragment in observations {
            if let previous = lines.last?.first, abs(fragment.0.midY - previous.0.midY) < min(previous.0.height,fragment.0.height)*0.48 {
                lines[lines.count-1].append(fragment)
            } else { lines.append([fragment]) }
        }
        var result = RecognizedDocument()
        var output = [String]()
        for line in lines {
            let fragments = line.sorted { $0.0.minX < $1.0.minX }
            let text = fragments.map{$0.1.string}.joined(separator:"  ")
            output.append(text)
            if fragments.contains(where:{ $0.1.confidence < 0.75 }) {
                result.uncertainLines.append(["text":text,"page":page])
            }
        }
        result.text = output.joined(separator:"\n")
        if result.text.isEmpty { result.warnings.append("Текст на странице \(page) не распознан. Проверьте оригинал.") }
        if !supported.contains("ru-RU") { result.warnings.append("На устройстве недоступно распознавание русского языка. Проверьте русскоязычные поля.") }
        return result
    }
}
