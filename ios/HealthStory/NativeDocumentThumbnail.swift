import ImageIO
import PDFKit
import SwiftUI

enum NativeDocumentThumbnail {
    private static let prefix="data:image/jpeg;base64,"
    private static let size=144

    static func encode(_ data:Data,type:String)->String? {
        let image:UIImage
        if type=="application/pdf" {
            guard let document=PDFDocument(data:data),let page=document.page(at:0) else {return nil}
            let bounds=page.bounds(for:.cropBox).size
            let longSide=max(bounds.width,bounds.height)
            guard longSide.isFinite,longSide>0 else {return nil}
            let scale=CGFloat(size)/longSide
            image=withExtendedLifetime(document) {
                page.thumbnail(of:CGSize(width:max(1,bounds.width*scale),height:max(1,bounds.height*scale)),for:.cropBox)
            }
        } else if type.hasPrefix("image/"),
                  let source=CGImageSourceCreateWithData(data as CFData,[kCGImageSourceShouldCache:false] as CFDictionary),
                  let thumbnail=CGImageSourceCreateThumbnailAtIndex(source,0,[
                      kCGImageSourceCreateThumbnailFromImageAlways:true,
                      kCGImageSourceCreateThumbnailWithTransform:true,
                      kCGImageSourceThumbnailMaxPixelSize:size
                  ] as CFDictionary) {
            image=UIImage(cgImage:thumbnail)
        } else {return nil}
        guard let jpeg=image.jpegData(compressionQuality:0.58) else {return nil}
        let value=prefix+jpeg.base64EncodedString()
        return value.utf8.count<24000 ? value:nil
    }

    static func decode(_ value:String) -> UIImage? {
        guard value.utf8.count<24000,value.hasPrefix(prefix),
              let jpeg=Data(base64Encoded:String(value.dropFirst(prefix.count))),
              let source=CGImageSourceCreateWithData(jpeg as CFData,nil),
              let thumbnail=CGImageSourceCreateThumbnailAtIndex(source,0,[
                  kCGImageSourceCreateThumbnailFromImageAlways:true,
                  kCGImageSourceThumbnailMaxPixelSize:size
              ] as CFDictionary) else {return nil}
        return UIImage(cgImage:thumbnail)
    }
}

struct NativeDocumentLabel:View {
    let file:JournalObject
    var body:some View {
        HStack(spacing:10) {
            if let image=NativeDocumentThumbnail.decode(caption(file,"thumbnail")) {
                Image(uiImage:image).resizable().scaledToFit().frame(width:42,height:44)
                    .accessibilityHidden(true)
            }
            Text(caption(file,"name"))
        }
    }
}
